package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdminValidationTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String REQUEST = "11111111-1111-4111-8111-111111111111";

    private static JsonNode body(String value) {
        return JSON.readTree(value);
    }

    private static void rejects(String value, String message) {
        assertThatThrownBy(() -> AdministrationService.validateMutation(body(value), "user"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> {
                    assertThat(error.code).isEqualTo("INVALID_REQUEST");
                    assertThat(error.getMessage()).isEqualTo(message);
                });
    }

    @Test void acceptsExactUserMutation() {
        Map<String, Object> input = AdministrationService.validateMutation(
                body("{\"requestId\":\"" + REQUEST + "\",\"reason\":\" 人工调整 \",\"role\":\"admin\",\"disabled\":false}"), "user");
        assertThat(input).containsEntry("requestId", REQUEST).containsEntry("reason", " 人工调整 ")
                .containsEntry("role", "admin").containsEntry("disabled", false);
    }

    @Test void rejectsExtraOrMissingFieldsAndWrongTypes() {
        rejects("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"人工调整\",\"role\":\"admin\"}", "管理参数无效，请核对填写内容。");
        rejects("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"人工调整\",\"role\":\"admin\",\"disabled\":false,\"extra\":1}",
                "管理参数无效，请核对填写内容。");
        rejects("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"人工调整\",\"role\":\"owner\",\"disabled\":false}",
                "管理参数无效，请核对填写内容。");
        rejects("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"人工调整\",\"role\":\"user\",\"disabled\":0}",
                "管理参数无效，请核对填写内容。");
    }

    @Test void rejectsInvalidRequestIdOrShortReason() {
        rejects("{\"requestId\":\"not-a-uuid\",\"reason\":\"人工调整\",\"role\":\"user\",\"disabled\":false}",
                "请填写有效操作编号及至少3字的操作原因。");
        rejects("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"  短 \",\"role\":\"user\",\"disabled\":false}",
                "请填写有效操作编号及至少3字的操作原因。");
    }

    @Test void validatesQuotaRangeAndDuration() {
        Map<String, Object> input = AdministrationService.validateMutation(
                body("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"补充权益\",\"seconds\":30,\"delta\":-2}"), "quota");
        assertThat(input).containsEntry("seconds", 30).containsEntry("delta", -2);
        assertThatThrownBy(() -> AdministrationService.validateMutation(
                body("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"补充权益\",\"seconds\":45,\"delta\":1}"), "quota"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_REQUEST"));
        assertThatThrownBy(() -> AdministrationService.validateMutation(
                body("{\"requestId\":\"" + REQUEST + "\",\"reason\":\"补充权益\",\"seconds\":15,\"delta\":1000001}"), "quota"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_REQUEST"));
    }

    @Test void keepsNullFieldsForIdempotentComparison() {
        Map<String, Object> services = AdministrationService.validateMutation(body("{\"requestId\":\"" + REQUEST
                + "\",\"reason\":\"暂停服务\",\"version\":2,\"paused\":{\"studio\":true,\"video\":false,\"prompt\":false}}"), "settings");
        assertThat(services).containsEntry("version", 2).containsEntry("enabled", null).containsEntry("zh", null)
                .containsEntry("en", null).containsEntry("paused", Map.of("studio", true, "video", false, "prompt", false));
        Map<String, Object> announcement = AdministrationService.validateMutation(body("{\"requestId\":\"" + REQUEST
                + "\",\"reason\":\"发布公告\",\"version\":0,\"enabled\":true,\"zh\":\"维护通知\",\"en\":\"Maintenance\"}"), "settings");
        assertThat(announcement).containsEntry("paused", null).containsEntry("enabled", true)
                .containsEntry("zh", "维护通知").containsEntry("en", "Maintenance");
    }

    @Test void rejectsIncompletePausedMapAndOverlongAnnouncement() {
        for (String value : new String[]{
                "{\"requestId\":\"" + REQUEST + "\",\"reason\":\"暂停服务\",\"version\":0,\"paused\":{\"studio\":true}}",
                "{\"requestId\":\"" + REQUEST + "\",\"reason\":\"暂停服务\",\"version\":0,\"paused\":{\"studio\":1,\"video\":false,\"prompt\":false}}",
                "{\"requestId\":\"" + REQUEST + "\",\"reason\":\"发布公告\",\"version\":0,\"enabled\":true,\"zh\":\"" + "长".repeat(241) + "\",\"en\":\"x\"}"}) {
            assertThatThrownBy(() -> AdministrationService.validateMutation(body(value), "settings"))
                    .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_REQUEST"));
        }
    }
}
