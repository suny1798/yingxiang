package cn.yingxiang.service;

import cn.yingxiang.common.BillingPolicy;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.BillingMapper;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.Map;

/** 一份积分余额供三个场景使用；结算只能由后台可信计量调用，不暴露浏览器结算入口。 */
@Service
@Profile("local")
@Transactional
public class BillingService {
    private final BillingMapper mapper;
    private final String schema;
    private final boolean enabled;
    public BillingService(BillingMapper mapper, Environment env) {
        this.mapper = mapper;
        String name = env.getRequiredProperty("migration.db-schema");
        if (!name.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid billing schema");
        schema = '"' + name + '"' + ".";
        enabled = Boolean.parseBoolean(env.getProperty("migration.billing-enabled", "false"));
    }
    public boolean enabled() { return enabled; }
    @Transactional(readOnly = true)
    public Map<String,Object> view(String userId, String environment) {
        environment(environment);
        var wallet = mapper.wallet(schema, userId, environment);
        return MigrationSupport.body("environment", environment, "availableCredits", number(wallet, "available_credits"),
                "reservedCredits", number(wallet, "reserved_credits"), "spentCredits", number(wallet, "spent_credits"),
                "creditsPerSecond", BillingPolicy.CATALOG.creditsPerSecond(), "billingEnabled", enabled,
                "realtimeMeterReady", false, "history", mapper.history(schema, userId, environment));
    }
    /** 只在服务端确认订单paid的同一事务中发放；测试订单永远进入沙盒钱包。 */
    public void fundSandbox(String userId, String orderId, String sku, int paidMinor, String currency) {
        var plan = BillingPolicy.topup(sku);
        if (plan.paidMinor() != paidMinor || !BillingPolicy.CATALOG.currency().equals(currency)) throw new BusinessFailure("PAYMENT_MISMATCH", "充值金额不匹配。", 409);
        String environment = "stripe_sandbox", key = "topup:" + orderId;
        lock(userId, environment);
        var previous = mapper.entry(schema, key);
        if (previous != null) {
            if (!userId.equals(previous.get("user_id")) || number(previous,"paid_minor") != paidMinor)
                throw new BusinessFailure("PAYMENT_MISMATCH", "充值归属不匹配。", 409);
            return;
        }
        mapper.change(schema, userId, environment, plan.credits(), 0, 0);
        mapper.insertEntry(schema, key, userId, environment, "topup", plan.credits(), 0, 0,
                (long) paidMinor, currency, System.currentTimeMillis());
    }
    public long adjust(String userId, String requestId, long delta) {
        if (delta == 0) throw new BusinessFailure("INVALID_REQUEST", "调整积分不能为0。", 400);
        var wallet = lock(userId, "real_usage");
        long available = number(wallet, "available_credits");
        if (available + delta < 0) throw new BusinessFailure("INSUFFICIENT_AVAILABLE", "可用积分不足，不能扣减。", 409);
        long now = System.currentTimeMillis();
        mapper.change(schema, userId, "real_usage", delta, 0, 0);
        mapper.insertEntry(schema, "admin-adjust:" + requestId, userId, "real_usage", "adjust", delta, 0, 0,
                null, BillingPolicy.CATALOG.currency(), now);
        return available + delta;
    }
    public void reserve(String userId, String environment, String id, String scene, long milliseconds) {
        environment(environment);
        BillingPolicy.quote(scene, milliseconds);
        var wallet = lock(userId, environment);
        var previous = mapper.charge(schema, id);
        if (previous != null) {
            if (!userId.equals(previous.get("user_id")) || !environment.equals(previous.get("environment"))
                    || !scene.equals(previous.get("scene")) || number(previous, "reserved_ms") != milliseconds)
                throw new BusinessFailure("BILLING_CONFLICT", "同一生成编号不能更改计费信息。", 409);
            return;
        }
        long amount = BillingPolicy.costCredits(milliseconds);
        if (number(wallet, "available_credits") < amount) throw new BusinessFailure("BALANCE_INSUFFICIENT", "积分不足，请先充值。", 409);
        long now = System.currentTimeMillis();
        mapper.change(schema, userId, environment, -amount, amount, 0);
        mapper.reserve(schema, id, userId, environment, scene, milliseconds, amount, now);
        mapper.insertEntry(schema, "reserve:" + id, userId, environment, "reserve", -amount, amount, 0, null, BillingPolicy.CATALOG.currency(), now);
    }
    /** milliseconds必须来自可信后台计量；0表示已确认无出画／任务失败。未知结果只review。 */
    public void settleVerified(String id, long milliseconds) {
        var charge = mapper.lockCharge(schema, id);
        if (charge == null) return; // 旧任务没有钱包预留，继续原有收尾。
        if (milliseconds < 0 || milliseconds > number(charge, "reserved_ms"))
            throw new BusinessFailure("BILLING_USAGE_INVALID", "结算时长超出预留范围。", 409);
        long amount = BillingPolicy.costCredits(milliseconds);
        if ("settled".equals(charge.get("state")) || "released".equals(charge.get("state"))) {
            if (number(charge, "settled_ms") != milliseconds)
                throw new BusinessFailure("BILLING_CONFLICT", "此任务已结算，不能更改用量。", 409);
            return;
        }
        String userId = (String) charge.get("user_id"), environment = (String) charge.get("environment");
        lock(userId, environment);
        long reserved = number(charge, "reserved_credits"), refund = reserved - amount, now = System.currentTimeMillis();
        mapper.change(schema, userId, environment, refund, -reserved, amount);
        String kind = amount == 0 ? "release" : "settle";
        mapper.settle(schema, id, milliseconds, amount, amount == 0 ? "released" : "settled", now);
        mapper.insertEntry(schema, kind + ":" + id, userId, environment, kind, refund, -reserved, amount, null, BillingPolicy.CATALOG.currency(), now);
    }
    public void review(String id) { mapper.review(schema, id); }
    @Transactional(readOnly = true)
    public java.util.List<Map<String,Object>> pendingVideos() { return mapper.pendingVideos(schema); }
    public void settleVideoVerified(String id, String state) {
        var charge = mapper.charge(schema, id);
        if (charge == null) return;
        if (!"video".equals(charge.get("scene"))) throw new BusinessFailure("BILLING_CONFLICT", "计费场景不匹配。", 409);
        if ("completed".equals(state)) {
            Long actual = mapper.videoDuration(schema, id);
            if (actual == null) { review(id); return; }
            settleVerified(id, Math.min(actual, number(charge, "reserved_ms")));
        }
        else if ("failed".equals(state)) settleVerified(id, 0);
    }
    public void requireRealtimeMeter() {
        if (enabled) throw new BusinessFailure("BILLING_METER_UNAVAILABLE", "实时用量核验尚未接通，暂不开放积分扣费。", 503);
    }
    private Map<String,Object> lock(String userId, String environment) {
        mapper.ensure(schema, userId, environment);
        return mapper.lock(schema, userId, environment);
    }
    private static void environment(String environment) {
        if (!java.util.List.of("real_usage", "stripe_sandbox").contains(environment)) throw new IllegalArgumentException("Invalid wallet environment");
    }
    private static long number(Map<String,Object> row, String key) { return row == null ? 0 : MigrationSupport.number(row,key); }
}
