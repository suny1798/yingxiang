package cn.yingxiang.bootstrap;

import cn.yingxiang.common.CompatiblePassword;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.service.AccountAuthService;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import static org.assertj.core.api.Assertions.*;

class CompatiblePasswordTest {
    @Test void matchesPythonAndNodeEncodingVectors() throws Exception {
        try (var input = getClass().getResourceAsStream("/legacy-password-vectors.json")) {
            var rows = JsonMapper.builder().build().readValue(input, Vector[].class);
            assertThat(rows).hasSize(7);
            for (Vector row : rows) {
                assertThat(CompatiblePassword.hash(row.password(), row.salt())).isEqualTo(row.expected());
            }
        }
    }
    @Test void validationCountsUtf16UnitsAndPreservesAsciiUsernames() {
        assertThatCode(() -> AccountAuthService.validate("User_123", "😀".repeat(64))).doesNotThrowAnyException();
        for (String password : List.of("x".repeat(7), "x".repeat(129), "😀".repeat(65))) {
            assertThatThrownBy(() -> AccountAuthService.validate("User_123", password)).isInstanceOf(BusinessFailure.class);
        }
        assertThatThrownBy(() -> AccountAuthService.validate("中文账号", "valid-password")).isInstanceOf(BusinessFailure.class);
        assertThat(CompatiblePassword.equal("a".repeat(128), "b".repeat(128))).isFalse();
    }
    public record Vector(String password, String salt, String expected) {}
}
