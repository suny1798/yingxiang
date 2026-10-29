package cn.yingxiang.bootstrap;

import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.service.EntitlementReservationService;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

class EntitlementReservationTest {
    @Test void inputRejectsBeforeAnyDatabaseWrite() {
        assertThatCode(() -> EntitlementReservationService.validate(UUID.randomUUID().toString(), 15)).doesNotThrowAnyException();
        assertThatThrownBy(() -> EntitlementReservationService.validate("invalid", 15))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.getCode()).isEqualTo("INVALID_REQUEST"));
        assertThatThrownBy(() -> EntitlementReservationService.validate(UUID.randomUUID().toString(), 45))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.getCode()).isEqualTo("INVALID_DURATION"));
    }
}
