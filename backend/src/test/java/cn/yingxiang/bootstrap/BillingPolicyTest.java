package cn.yingxiang.bootstrap;

import cn.yingxiang.common.BillingPolicy;
import cn.yingxiang.service.PaymentsService;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class BillingPolicyTest {
    @Test void sameRateForAllScenesAndRoundUpPartialSeconds() {
        for (String scene : java.util.List.of("studio","prompt"))
            assertThat(BillingPolicy.quote(scene,15000).get("credits")).isEqualTo(15L);
        assertThat(BillingPolicy.quote("video",10000).get("credits")).isEqualTo(10L);
        assertThat(BillingPolicy.costCredits(7700)).isEqualTo(8);
        assertThat(BillingPolicy.costCredits(0)).isZero();
        assertThat(BillingPolicy.costCredits(30000)).isEqualTo(30);
        assertThat(BillingPolicy.quote("video",30000).get("credits")).isEqualTo(30L);
        assertThatThrownBy(()->BillingPolicy.quote("video",30001)).isInstanceOf(RuntimeException.class);
    }
    @Test void newTopupsKeepOldProductsFrozen() {
        assertThat(BillingPolicy.CATALOG.plans()).extracting(BillingPolicy.Topup::credits).containsExactly(100,400,1000);
        assertThat(PaymentsService.product("credits-v2-creator").amount()).isEqualTo(1900);
        assertThat(PaymentsService.product("credits-v2-plus").templateVersion()).isEqualTo("credits-v2");
        assertThat(PaymentsService.product("credits-v2-creator").currency()).isEqualTo("usd");
        assertThat(PaymentsService.product("credits-v2-creator").credits()).isEqualTo(400);
        assertThat(BillingPolicy.CATALOG.plans().stream().map(plan -> plan.paidMinor()*10_000/plan.credits()).toList())
                .containsExactly(50000,47500,45000);
        assertThat(PaymentsService.product("credits-v1-creator").amount()).isEqualTo(12900);
        assertThat(PaymentsService.product("credits-v1-creator").credits()).isEqualTo(450);
    }
}
