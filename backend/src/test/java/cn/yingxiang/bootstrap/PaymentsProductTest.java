package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PaymentsProductTest {
    private static final String ORIGIN = "http://127.0.0.1:8791";

    @Test void mapsFrozenDurationSkus() {
        var product = PaymentsService.product("tryon-v1-15-5");
        assertThat(product.amount()).isEqualTo(2990);
        assertThat(product.seconds()).isEqualTo(15);
        assertThat(product.count()).isEqualTo(5);
        assertThat(product.currency()).isEqualTo("cny");
        assertThat(PaymentsService.product("tryon-v1-60-10").amount()).isEqualTo(20900);
        assertThat(PaymentsService.product("tryon-v1-30-1").amount()).isEqualTo(1290);
    }

    @Test void mapsCreditPacksAndKeepsSandboxScenes() {
        var product = PaymentsService.product("credits-v1-creator");
        assertThat(product.planId()).isEqualTo("creator");
        assertThat(product.credits()).isEqualTo(450);
        assertThat(product.amount()).isEqualTo(12900);
        assertThat(product.seconds()).isNull();
        assertThat(product.templateVersion()).isEqualTo("credits-v1");
        assertThatThrownBy(() -> PaymentsService.product("credits-v1-unknown"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_SKU"));
    }

    @Test void buildsCheckoutSnapshotWithoutRealPaymentLinks() {
        var order = new PaymentsService.Order("11111111-1111-4111-8111-111111111111", "user-1", "22222222-2222-4222-8222-222222222222",
                "tryon-v1-15-5", 15, 5, 2990, null, null, "cny", "creating", 1L, null, null, null, null, null);
        Map<String, Object> params = PaymentsService.checkoutParams(order, ORIGIN);
        assertThat(params.get("mode")).isEqualTo("payment");
        assertThat(params.get("client_reference_id")).isEqualTo(order.id());
        assertThat(params.get("success_url")).isEqualTo(ORIGIN + "/account?payment=returned");
        assertThat(params.get("cancel_url")).isEqualTo(ORIGIN + "/account?payment=cancelled");
        assertThat((String) params.get("integration_identifier")).matches("yingxiang_test_[a-z]{8}");
        assertThat(params.get("metadata")).isEqualTo(Map.of("orderId", order.id(), "userId", "user-1", "sku", "tryon-v1-15-5"));
    }

    @Test void buildsCreditPackSnapshotWithOrderReturn() {
        var order = new PaymentsService.Order("33333333-3333-4333-8333-333333333333", "user-2", "44444444-4444-4444-8444-444444444444",
                "credits-v1-light", null, null, 3900, "light", 120, "cny", "creating", 1L, null, null, null, null, null);
        Map<String, Object> params = PaymentsService.checkoutParams(order, ORIGIN);
        assertThat(params.get("success_url")).isEqualTo(ORIGIN + "/account/orders?payment=returned&orderId=" + order.id());
        assertThat(params.get("cancel_url")).isEqualTo(ORIGIN + "/account/orders?payment=cancelled");
        @SuppressWarnings("unchecked")
        Map<String, Object> line = ((List<Map<String, Object>>) params.get("line_items")).getFirst();
        @SuppressWarnings("unchecked")
        Map<String, Object> price = (Map<String, Object>) line.get("price_data");
        assertThat(price.get("unit_amount")).isEqualTo(3900);
        assertThat(((Map<?, ?>) price.get("product_data")).get("name")).isEqualTo("映想轻享包 · 120积分（沙盒，积分不过期）");
    }

    @Test void onlyAcceptsStripeCheckoutHttpsUrls() {
        assertThat(PaymentsService.safeUrl("https://checkout.stripe.com/c/pay/cs_test_1")).isTrue();
        for (Object value : new Object[]{null, "", "http://checkout.stripe.com/x", "https://checkout.stripe.com.evil/x",
                "https://evil.invalid/x", 42}) {
            assertThat(PaymentsService.safeUrl(value)).isFalse();
        }
    }

    @Test void encodesStripeFormWithoutLosingNestedFields() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("mode", "payment");
        params.put("metadata", Map.of("orderId", "a b"));
        params.put("line_items", List.of(Map.of("quantity", 1, "price_data", Map.of("unit_amount", 2990))));
        params.put("adaptive_pricing", Map.of("enabled", false));
        String form = StripeGateway.Http.form(params);
        assertThat(form).contains("mode=payment").contains("metadata%5BorderId%5D=a%20b")
                .contains("line_items%5B0%5D%5Bquantity%5D=1")
                .contains("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2990")
                .contains("adaptive_pricing%5Benabled%5D=false");
    }

    @Test void refusesNonLoopbackStripeBase() {
        assertThatThrownBy(() -> new StripeGateway.Http("https://api.stripe.com", "sk_test_x"))
                .isInstanceOf(IllegalStateException.class);
    }
}
