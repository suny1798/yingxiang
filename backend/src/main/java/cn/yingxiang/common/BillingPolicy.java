package cn.yingxiang.common;

import cn.yingxiang.exception.BusinessFailure;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.Map;

/** 消耗以整数积分记账；支付金额使用USD美分，禁止把货币与积分混为同一单位。 */
public final class BillingPolicy {
    public record Topup(String id, String name, int paidMinor, int credits, boolean featured) {
        public String sku() { return "credits-v2-" + id; }
    }
    public record Catalog(String version, String currency, int creditsPerSecond,
                          int basePriceMicroUsdPerCredit, int minimumPriceMicroUsdPerCredit, String rounding,
                          List<Integer> realtimeSeconds, int videoMaxSeconds, List<Topup> plans) {}
    public static final Catalog CATALOG = load();
    private BillingPolicy() {}
    private static Catalog load() {
        try (var stream = BillingPolicy.class.getResourceAsStream("/billing-catalog.json")) {
            return new JsonMapper().readValue(stream, Catalog.class);
        } catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }
    public static Topup topup(String sku) {
        return CATALOG.plans().stream().filter(plan -> plan.sku().equals(sku)).findFirst()
                .orElseThrow(() -> new BusinessFailure("INVALID_SKU", "请选择有效充值档位。", 400));
    }
    public static boolean isTopup(String sku) { return sku != null && sku.startsWith("credits-v2-"); }
    public static long costCredits(long milliseconds) {
        if (milliseconds < 0 || milliseconds > 60_000) throw new BusinessFailure("INVALID_DURATION", "计费时长无效。", 400);
        return ((milliseconds + 999) / 1000) * CATALOG.creditsPerSecond();
    }
    public static Map<String, Object> quote(String scene, long milliseconds) {
        boolean realtime = List.of("studio", "prompt").contains(scene);
        if ((!realtime && !"video".equals(scene)) || milliseconds <= 0
                || (realtime && !CATALOG.realtimeSeconds().contains((int) (milliseconds / 1000)))
                || (realtime && milliseconds % 1000 != 0)
                || (!realtime && milliseconds > CATALOG.videoMaxSeconds() * 1000L)) {
            throw new BusinessFailure("INVALID_DURATION", "请选择15／30秒，或上传1—30秒视频。", 400);
        }
        return MigrationSupport.body("version", CATALOG.version(), "scene", scene, "milliseconds", milliseconds,
                "billedSeconds", (milliseconds + 999) / 1000, "credits", costCredits(milliseconds));
    }
}
