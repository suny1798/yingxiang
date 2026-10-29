package cn.yingxiang.exception;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExceptionFoundationTest {

    @Test
    void errorCodeMapsHttpStatusToGeneralCode() {
        assertThat(ErrorCode.fromStatus(400)).isEqualTo(ErrorCode.PARAMS_ERROR);
        assertThat(ErrorCode.fromStatus(401)).isEqualTo(ErrorCode.NOT_LOGIN_ERROR);
        assertThat(ErrorCode.fromStatus(403)).isEqualTo(ErrorCode.FORBIDDEN_ERROR);
        assertThat(ErrorCode.fromStatus(404)).isEqualTo(ErrorCode.NOT_FOUND_ERROR);
        assertThat(ErrorCode.fromStatus(409)).isEqualTo(ErrorCode.CONFLICT_ERROR);
        assertThat(ErrorCode.fromStatus(413)).isEqualTo(ErrorCode.PAYLOAD_TOO_LARGE_ERROR);
        assertThat(ErrorCode.fromStatus(415)).isEqualTo(ErrorCode.UNSUPPORTED_MEDIA_TYPE_ERROR);
        assertThat(ErrorCode.fromStatus(500)).isEqualTo(ErrorCode.SYSTEM_ERROR);
        assertThat(ErrorCode.fromStatus(503)).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE_ERROR);
        assertThat(ErrorCode.fromStatus(418)).isEqualTo(ErrorCode.OPERATION_ERROR);
    }

    @Test
    void businessExceptionCarriesReasonAndStatus() {
        BusinessException error = new BusinessException(ErrorCode.NOT_FOUND_ERROR, "作品不存在。", "WORK_NOT_FOUND");

        assertThat(error.getCode()).isEqualTo(40400);
        assertThat(error.getStatus()).isEqualTo(404);
        assertThat(error.getReason()).isEqualTo("WORK_NOT_FOUND");
        assertThat(error.getMessage()).isEqualTo("作品不存在。");
    }

    @Test
    void throwIfOnlyThrowsWhenConditionHolds() {
        assertThatCode(() -> ThrowUtils.throwIf(false, ErrorCode.PARAMS_ERROR)).doesNotThrowAnyException();
        assertThatThrownBy(() -> ThrowUtils.throwIf(true, ErrorCode.PARAMS_ERROR))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(40000);
                    assertThat(error.getStatus()).isEqualTo(400);
                });
    }

    @Test
    void throwIfAcceptsCustomMessage() {
        assertThatThrownBy(() -> ThrowUtils.throwIf(true, ErrorCode.CONFLICT_ERROR, "作品尚未生成完成。"))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(40900);
                    assertThat(error.getMessage()).isEqualTo("作品尚未生成完成。");
                });
    }
}
