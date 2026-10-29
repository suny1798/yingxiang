package cn.yingxiang.bootstrap;

import cn.yingxiang.manager.ClientTokenValidator;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.*;

class ClientTokenValidatorTest {
    @Test void studioPolicyTracksFrozenLegacyPolicy() throws Exception {
        var json = JsonMapper.builder().build();
        try (var input = getClass().getResourceAsStream("/studio-policy.json")) {
            assertThat(json.readTree(input)).isEqualTo(json.readTree(java.nio.file.Files.readAllBytes(java.nio.file.Path.of("contracts/node-fixtures.json"))).get("studio"));
        }
    }
    @Test void matchesFrozenPythonVectorsWithoutUsingCredentialsOrNetwork() throws Exception {
        try (var input = getClass().getResourceAsStream("/legacy-token-vectors.json")) {
            JsonNode fixture = JsonMapper.builder().build().readTree(input);
            assertThat(fixture.get("vectors").size()).isGreaterThanOrEqualTo(50);
            for (JsonNode row : fixture.get("vectors")) {
                var action = (org.assertj.core.api.ThrowableAssert.ThrowingCallable) () -> ClientTokenValidator.validate(
                        row.get("token"), fixture.get("model").asString(), fixture.get("origin").asString(),
                        row.get("seconds").asInt(), fixture.get("permanentKey").asString(), fixture.get("receivedAt").asLong());
                if (row.get("expected").asString().equals("OK")) assertThatCode(action).as(row.get("name").asString()).doesNotThrowAnyException();
                else assertThatThrownBy(action).as(row.get("name").asString()).isInstanceOf(ClientTokenValidator.InvalidToken.class)
                        .hasMessage(row.get("expected").asString());
            }
        }
    }

    @Test void nonObjectResponseNeverLeaksTokenMaterial() {
        var json = JsonMapper.builder().build();
        for (String source : new String[]{"null", "[]", "\"synthetic-sensitive-response\""}) {
            assertThatThrownBy(() -> ClientTokenValidator.validate(json.readTree(source), "model", "origin", 15, "permanent", 0))
                    .isInstanceOf(ClientTokenValidator.InvalidToken.class).hasMessage("INVALID_TOKEN_KEY");
        }
    }
}
