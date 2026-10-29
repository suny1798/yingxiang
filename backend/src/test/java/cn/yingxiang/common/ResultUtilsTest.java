package cn.yingxiang.common;

import cn.yingxiang.exception.ErrorCode;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ResultUtilsTest {

    @Test
    void successWrapsDataWithZeroCode() {
        BaseResponse<Map<String, Object>> response = ResultUtils.success(Map.of("ready", true));

        assertThat(response.getCode()).isZero();
        assertThat(response.getMessage()).isEqualTo("ok");
        assertThat(response.getData()).containsEntry("ready", true);
        assertThat(response.getReason()).isNull();
    }

    @Test
    void successWithoutDataKeepsNullData() {
        BaseResponse<Void> response = ResultUtils.success();

        assertThat(response.getCode()).isZero();
        assertThat(response.getData()).isNull();
    }

    @Test
    void errorUsesGeneralCodeAndOptionalReason() {
        BaseResponse<?> response = ResultUtils.error(ErrorCode.PARAMS_ERROR, "请求内容无法读取。", "INVALID_REQUEST");

        assertThat(response.getCode()).isEqualTo(40000);
        assertThat(response.getMessage()).isEqualTo("请求内容无法读取。");
        assertThat(response.getReason()).isEqualTo("INVALID_REQUEST");
        assertThat(response.getData()).isNull();
    }

    @Test
    void errorByStatusCodeKeepsReason() {
        BaseResponse<?> response = ResultUtils.error(40900, "资源状态冲突", "WORK_NOT_READY");

        assertThat(response.getCode()).isEqualTo(40900);
        assertThat(response.getReason()).isEqualTo("WORK_NOT_READY");
    }
}
