package cn.yingxiang.service;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.StripeGateway;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.mapper.MigrationAccounts;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** M13-a：沙盒订单、Checkout、查单与通知；账务与旧Payments同事务语义。 */
@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.payments-enabled", havingValue = "true")
public class PaymentsService {
    private static final Map<Integer, Map<Integer, Integer>> PRICES = Map.of(
            15, Map.of(1, 690, 5, 2990, 10, 5690),
            30, Map.of(1, 1290, 5, 5690, 10, 10900),
            60, Map.of(1, 2390, 5, 10900, 10, 20900));
    private static final Map<String, Plan> CREDIT_PLANS = Map.of(
            "light", new Plan("轻享包", 3900, 120, List.of("tryon", "video")),
            "creator", new Plan("创作包", 12900, 450, List.of("tryon", "video", "edit")),
            "plus", new Plan("进阶包", 32900, 1200, List.of("tryon", "video", "edit")));

    public record Plan(String name, int amount, int credits, List<String> scenes) {}
    public record Product(String sku, Integer seconds, Integer count, int amount, String currency,
                   String planId, Integer credits, String templateVersion) {}
    public record Order(String id, String userId, String requestId, String sku, Integer seconds, Integer count,
                 int amount, String planId, Integer credits, String currency, String state, long createdAt,
                 String sessionId, String checkoutUrl, Long expiresAt, Long fulfilledAt, String requestSnapshot) {}

    private final JdbcTemplate jdbc;
    private final MigrationAccounts accounts;
    private final RateLimitService rateLimit;
    private final JsonMapper json;
    private final TransactionTemplate transaction;
    private final String schema;
    private final String secret;
    private final String webhookSecret;
    private final String expectedAccount;
    private final StripeGateway gateway;

    public PaymentsService(JdbcTemplate jdbc, MigrationAccounts accounts, RateLimitService rateLimit,
                           PlatformTransactionManager manager, Environment env, JsonMapper json) {
        this.jdbc = jdbc; this.accounts = accounts; this.rateLimit = rateLimit; this.json = json;
        this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M13 payments");
        this.secret = env.getProperty("migration.stripe-secret", "");
        this.webhookSecret = env.getProperty("migration.stripe-webhook-secret", "");
        this.expectedAccount = env.getProperty("migration.stripe-expected-account", "");
        this.gateway = new StripeGateway.Http(env.getRequiredProperty("migration.stripe-api-base"), secret, RuntimePolicy.runtime(env));
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(10);
    }

    public boolean enabled() {
        return secret.matches("^(rk|sk)_test_.+") && webhookSecret.startsWith("whsec_") && expectedAccount.startsWith("acct_");
    }

    public void requireEnabled() {
        if (!enabled()) throw new BusinessFailure("PAYMENTS_DISABLED", "沙盒支付尚未配置，正式购买暂未开放。", 503);
    }

    public Map<String, Object> status() {
        return MigrationSupport.body("testEnabled", enabled(), "liveEnabled", false);
    }

    public static Product product(String sku) {
        for (var entry : CREDIT_PLANS.entrySet()) {
            if (sku != null && sku.equals("credits-v1-" + entry.getKey())) {
                Plan plan = entry.getValue();
                return new Product(sku, null, null, plan.amount(), "cny", entry.getKey(), plan.credits(), "credits-v1");
            }
        }
        for (var seconds : PRICES.entrySet()) {
            for (var count : seconds.getValue().entrySet()) {
                if (sku != null && sku.equals("tryon-v1-" + seconds.getKey() + "-" + count.getKey())) {
                    return new Product(sku, seconds.getKey(), count.getKey(), count.getValue(), "cny", null, null, null);
                }
            }
        }
        throw new BusinessFailure("INVALID_SKU", "请选择有效体验包。", 400);
    }

    public static Map<String, Object> checkoutParams(Order order, String publicOrigin) {
        String suffix = suffix(order.id());
        String name = order.planId() != null
                ? "映想" + CREDIT_PLANS.get(order.planId()).name() + " · " + order.credits() + "积分（沙盒，积分不过期）"
                : "映想实时换装 · " + order.seconds() + "秒 × " + order.count() + "次（沙盒）";
        String accountPath = order.planId() != null ? "/account/orders" : "/account";
        String returnQuery = order.planId() != null ? "&orderId=" + order.id() : "";
        Map<String, Object> priceData = new LinkedHashMap<>();
        priceData.put("currency", order.currency());
        priceData.put("unit_amount", order.amount());
        priceData.put("product_data", Map.of("name", name));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", "payment");
        result.put("client_reference_id", order.id());
        result.put("metadata", Map.of("orderId", order.id(), "userId", order.userId(), "sku", order.sku()));
        result.put("line_items", List.of(Map.of("quantity", 1, "price_data", priceData)));
        result.put("success_url", publicOrigin + accountPath + "?payment=returned" + returnQuery);
        result.put("cancel_url", publicOrigin + accountPath + "?payment=cancelled");
        result.put("adaptive_pricing", Map.of("enabled", false));
        result.put("integration_identifier", "yingxiang_test_" + suffix);
        return result;
    }

    public Map<String, Object> list(String hashed) {
        return transaction.execute(status -> {
            MigrationAccounts.User user = accounts.require(hashed);
            List<Map<String, Object>> orders = jdbc.queryForList("SELECT * FROM " + schema
                    + "orders WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50", user.id());
            Map<String, Integer> credits = new LinkedHashMap<>();
            for (var row : jdbc.queryForList("SELECT seconds,total,reserved,used,revoked FROM " + schema
                    + "entitlement_grants WHERE user_id=? AND environment='stripe_sandbox'", user.id())) {
                String key = String.valueOf(MigrationSupport.number(row, "seconds"));
                credits.merge(key, (int) (MigrationSupport.number(row, "total") - MigrationSupport.number(row, "reserved")
                        - MigrationSupport.number(row, "used") - MigrationSupport.number(row, "revoked")), Integer::sum);
            }
            List<Map<String, Object>> packs = new ArrayList<>();
            for (var row : jdbc.queryForList("SELECT * FROM " + schema
                    + "sandbox_credit_packs WHERE user_id=? ORDER BY created_at,order_id", user.id())) {
                packs.add(MigrationSupport.body("orderId", row.get("order_id"), "planId", row.get("plan_id"),
                        "credits", row.get("credits"), "scenes", json.readValue((String) row.get("scenes"), List.class),
                        "createdAt", MigrationSupport.iso(MigrationSupport.number(row, "created_at"))));
            }
            List<Map<String, Object>> items = new ArrayList<>();
            for (var row : orders) {
                Order order = order(row);
                Map<String, Object> item = MigrationSupport.body("id", order.id(), "sku", order.sku());
                if (order.planId() != null) {
                    item.put("planId", order.planId());
                    item.put("credits", order.credits());
                }
                item.put("seconds", order.seconds());
                item.put("count", order.count());
                item.put("amount", order.amount());
                item.put("currency", order.currency());
                item.put("createdAt", MigrationSupport.iso(order.createdAt()));
                item.put("state", order.state());
                if (order.fulfilledAt() != null) item.put("fulfilledAt", MigrationSupport.iso(order.fulfilledAt()));
                items.add(item);
            }
            int balance = packs.stream().mapToInt(pack -> ((Number) pack.get("credits")).intValue()).sum();
            return MigrationSupport.body("sandboxCreditPacks", packs, "sandboxPointBalance", balance,
                    "orders", items, "sandboxCredits", credits);
        });
    }

    public Order reserve(String hashed, String sku, String requestId, String publicOrigin) {
        if (!MigrationSupport.isUuid(requestId)) {
            throw new BusinessFailure("INVALID_REQUEST", "支付操作编号无效。", 400);
        }
        Product item = product(sku);
        try {
            return transaction.execute(status -> {
                MigrationAccounts.User user = accounts.require(hashed);
                Order previous = find("SELECT * FROM " + schema + "orders WHERE user_id=? AND request_id=? FOR UPDATE",
                        user.id(), requestId);
                if (previous != null) {
                    if (!previous.sku().equals(sku)) {
                        throw new BusinessFailure("PAYMENT_CONFLICT", "同一操作不能更改方案。", 409);
                    }
                    return previous;
                }
                Order unknown = find("SELECT * FROM " + schema + "orders WHERE user_id=? AND sku=? AND state='creating' "
                        + "AND session_id IS NULL FOR UPDATE", user.id(), sku);
                if (unknown != null) return unknown;
                if (rateLimit.exceeded("checkout:" + user.id(), 10, 60 * 60_000L)) {
                    throw new BusinessFailure("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429);
                }
                String id = MigrationSupport.uuid();
                long now = System.currentTimeMillis();
                Order draft = new Order(id, user.id(), requestId, item.sku(), item.seconds(), item.count(),
                        item.amount(), item.planId(), item.credits(), item.currency(), "creating", now,
                        null, null, null, null, null);
                String snapshot = json.writeValueAsString(checkoutParams(draft, publicOrigin));
                Order created = new Order(id, user.id(), requestId, item.sku(), item.seconds(), item.count(),
                        item.amount(), item.planId(), item.credits(), item.currency(), "creating", now,
                        null, null, null, null, snapshot);
                jdbc.update("INSERT INTO " + schema + "orders(id,user_id,request_id,sku,seconds,count,amount,plan_id,credits,"
                                + "currency,state,created_at,request_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        created.id(), created.userId(), created.requestId(), created.sku(), created.seconds(),
                        created.count(), created.amount(), created.planId(), created.credits(), created.currency(),
                        created.state(), created.createdAt(), created.requestSnapshot());
                return created;
            });
        } catch (DataIntegrityViolationException error) {
            throw BusinessFailure.unavailable();
        }
    }

    public Order own(String hashed, String ident) {
        return transaction.execute(status -> {
            MigrationAccounts.User user = accounts.require(hashed);
            Order value = find("SELECT * FROM " + schema + "orders WHERE id=? AND user_id=?", ident, user.id());
            if (value == null) throw new BusinessFailure("ORDER_NOT_FOUND", "找不到此订单。", 404);
            return value;
        });
    }

    public Map<String, Object> checkout(String hashed, JsonNode body, String publicOrigin) {
        requireEnabled();
        if (!(body.size() == 2 && body.has("requestId") && body.has("sku")
                && body.get("requestId").isString() && body.get("sku").isString())) {
            throw new BusinessFailure("INVALID_REQUEST", "支付参数无效。", 400);
        }
        Order order = reserve(hashed, body.get("sku").asString(), body.get("requestId").asString(), publicOrigin);
        if (!expectedAccount.equals(gateway.accountId())) {
            throw new BusinessFailure("WRONG_ACCOUNT", "支付密钥不属于配置的映想沙盒。", 503);
        }
        if ("paid".equals(order.state())) return MigrationSupport.body("orderId", order.id(), "paid", true);
        if (order.sessionId() != null) {
            Map<String, Object> value = gateway.session(order.sessionId());
            apply(value, null, false);
            if ("open".equals(value.get("status")) && safeUrl(value.get("url"))) {
                return MigrationSupport.body("orderId", order.id(), "url", value.get("url"));
            }
            return MigrationSupport.body("orderId", order.id(), "paid", "paid".equals(value.get("payment_status")));
        }
        if (System.currentTimeMillis() - order.createdAt() > 23 * 60 * 60_000L) {
            throw new BusinessFailure("ORDER_REVIEW", "此订单需要人工核查，请勿重新付款。", 409);
        }
        Map<String, Object> params = checkoutParams(order, publicOrigin);
        if (order.requestSnapshot() != null) {
            Map<String, Object> snapshot = json.readValue(order.requestSnapshot(), Map.class);
            if (!snapshot.equals(params)) {
                throw new BusinessFailure("ORDER_REVIEW", "此订单需要人工核查，请勿重新付款。", 409);
            }
            params = snapshot;
        }
        Map<String, Object> value = gateway.createSession(params, "yingxiang-test-" + order.id());
        apply(value, null, false);
        if (!safeUrl(value.get("url"))) {
            throw new BusinessFailure("CHECKOUT_UNAVAILABLE", "支付链接尚未准备好，请到订单中核查。", 503);
        }
        return MigrationSupport.body("orderId", order.id(), "url", value.get("url"));
    }

    public Map<String, Object> reconcile(String hashed, JsonNode body, String publicOrigin) {
        requireEnabled();
        if (!(body.size() == 1 && body.has("orderId") && body.get("orderId").isString())) {
            throw new BusinessFailure("INVALID_REQUEST", "订单编号无效。", 400);
        }
        Order order = own(hashed, body.get("orderId").asString());
        if (order.sessionId() == null) {
            JsonNode retry = json.readTree(json.writeValueAsString(Map.of("sku", order.sku(), "requestId", order.requestId())));
            Map<String, Object> result = checkout(hashed, retry, publicOrigin);
            Map<String, Object> view = new LinkedHashMap<>(list(hashed));
            if (result.get("url") instanceof String url) view.put("url", url);
            return view;
        }
        Map<String, Object> value = gateway.session(order.sessionId());
        apply(value, null, false);
        Map<String, Object> view = new LinkedHashMap<>(list(hashed));
        if ("open".equals(value.get("status")) && value.get("url") instanceof String url) view.put("url", url);
        return view;
    }

    public Map<String, Object> webhook(byte[] payload, String signature) {
        requireEnabled();
        StripeGateway.verifySignature(payload, signature, webhookSecret, System.currentTimeMillis() / 1000);
        Map<String, Object> event;
        try {
            event = json.readValue(new String(payload, StandardCharsets.UTF_8), Map.class);
        } catch (RuntimeException error) {
            throw StripeGateway.invalidSignature();
        }
        if (event == null || !(event.get("data") instanceof Map<?, ?> data)
                || !(data.get("object") instanceof Map<?, ?> object) || !(object.get("id") instanceof String sessionId)
                || !(event.get("id") instanceof String eventId) || !(event.get("type") instanceof String type)) {
            throw StripeGateway.invalidSignature();
        }
        if (!Boolean.FALSE.equals(event.get("livemode")) || event.get("account") != null) {
            throw new BusinessFailure("WRONG_ACCOUNT_MODE", "只接受当前沙盒的直接付款通知。", 400);
        }
        if (Set.of("checkout.session.completed", "checkout.session.async_payment_succeeded",
                "checkout.session.async_payment_failed", "checkout.session.expired").contains(type)) {
            Map<String, Object> current = gateway.session(sessionId);
            apply(current, eventId, type.equals("checkout.session.async_payment_failed"));
        }
        return Map.of("received", true);
    }

    public void apply(Map<String, Object> value, String eventId, boolean failed) {
        transaction.executeWithoutResult(status -> {
            Map<?, ?> metadata = value.get("metadata") instanceof Map<?, ?> map ? map : Map.of();
            Object orderId = metadata.get("orderId");
            Order order = orderId instanceof String id ? find("SELECT * FROM " + schema + "orders WHERE id=? FOR UPDATE", id) : null;
            Object ident = value.get("id");
            Object amount = value.get("amount_total");
            boolean mismatch = order == null || !(ident instanceof String session) || session.isEmpty()
                    || !Boolean.FALSE.equals(value.get("livemode")) || !"payment".equals(value.get("mode"))
                    || !order.id().equals(value.get("client_reference_id"))
                    || !order.userId().equals(metadata.get("userId")) || !order.sku().equals(metadata.get("sku"))
                    || !order.currency().equals(value.get("currency"))
                    || !(amount instanceof Integer || amount instanceof Long) || ((Number) amount).longValue() != order.amount()
                    || (order.sessionId() != null && !order.sessionId().equals(ident))
                    || otherSession(ident, order.id());
            if (mismatch) throw new BusinessFailure("PAYMENT_MISMATCH", "付款资料不匹配，需要人工核查。", 409);
            String sessionId = (String) ident;
            if (eventId != null && !jdbc.queryForList("SELECT id FROM " + schema + "payment_events WHERE id=?", eventId).isEmpty()) return;
            Long expiresAt = value.get("expires_at") instanceof Number number ? number.longValue() : null;
            String checkoutUrl = safeUrl(value.get("url")) ? (String) value.get("url") : null;
            Long fulfilledAt = order.fulfilledAt();
            String state = order.state();
            if ("complete".equals(value.get("status")) && "paid".equals(value.get("payment_status"))) {
                if (fulfilledAt == null) {
                    if (order.planId() != null) {
                        jdbc.update("INSERT INTO " + schema + "sandbox_credit_packs(order_id,user_id,plan_id,credits,scenes,created_at) "
                                        + "VALUES (?,?,?,?,?,?)", order.id(), order.userId(), order.planId(), order.credits(),
                                json.writeValueAsString(CREDIT_PLANS.get(order.planId()).scenes()), System.currentTimeMillis());
                    } else {
                        accounts.grant(order.userId(), order.seconds(), order.count(), "paid", "order:" + order.id(), "stripe_sandbox");
                    }
                    fulfilledAt = System.currentTimeMillis();
                }
                state = "paid";
            } else if (fulfilledAt == null) {
                state = "expired".equals(value.get("status")) ? "expired" : failed || "failed".equals(order.state()) ? "failed" : "pending";
            }
            jdbc.update("UPDATE " + schema + "orders SET session_id=?,expires_at=?,"
                            + "checkout_url=CASE WHEN ? THEN ? ELSE checkout_url END,state=?,fulfilled_at=? WHERE id=?",
                    sessionId, expiresAt, checkoutUrl != null, checkoutUrl, state, fulfilledAt, order.id());
            if (eventId != null) {
                jdbc.update("INSERT INTO " + schema + "payment_events(id,order_id,source,created_at) VALUES (?,?,'stripe_sandbox',?)",
                        eventId, order.id(), System.currentTimeMillis());
            }
        });
    }

    private boolean otherSession(Object sessionId, String orderId) {
        return !jdbc.queryForList("SELECT id FROM " + schema + "orders WHERE id<>? AND session_id=?", orderId, sessionId).isEmpty();
    }

    private Order find(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        return rows.isEmpty() ? null : order(rows.getFirst());
    }

    private static Order order(Map<String, Object> row) {
        return new Order((String) row.get("id"), (String) row.get("user_id"), (String) row.get("request_id"),
                (String) row.get("sku"), row.get("seconds") instanceof Number s ? s.intValue() : null,
                row.get("count") instanceof Number c ? c.intValue() : null, (int) MigrationSupport.number(row, "amount"),
                (String) row.get("plan_id"), row.get("credits") instanceof Number cr ? cr.intValue() : null,
                (String) row.get("currency"), (String) row.get("state"), MigrationSupport.number(row, "created_at"),
                (String) row.get("session_id"), (String) row.get("checkout_url"),
                row.get("expires_at") instanceof Number e ? e.longValue() : null,
                row.get("fulfilled_at") instanceof Number f ? f.longValue() : null, (String) row.get("request_snapshot"));
    }

    public static boolean safeUrl(Object value) {
        if (!(value instanceof String text)) return false;
        try {
            URI uri = URI.create(text);
            return "https".equals(uri.getScheme()) && "checkout.stripe.com".equals(uri.getHost());
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static String suffix(String orderId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(orderId.getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder();
            for (int index = 0; index < 8; index++) value.append((char) ('a' + Math.floorMod(digest[index], 26)));
            return value.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException();
        }
    }

    public static String hex(byte[] value) { return HexFormat.of().formatHex(value); }
}
