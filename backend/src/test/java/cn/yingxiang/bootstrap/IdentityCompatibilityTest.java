package cn.yingxiang.bootstrap;

import cn.yingxiang.manager.SchemaOperations;
import cn.yingxiang.mapper.AccountReader;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Properties;
import static org.assertj.core.api.Assertions.*;

class IdentityCompatibilityTest {
    @Test void cookieUsesFirstValueWithoutDecoding() throws Exception {
        String token = "a".repeat(64);
        String expected = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        assertThat(AccountReader.cookieHash("other=x; yingxiang_session=" + token + "; yingxiang_session=" + "b".repeat(64))).isEqualTo(expected);
        assertThat(AccountReader.cookieHash("yingxiang_session=invalid; yingxiang_session=" + token)).isEmpty();
        assertThat(AccountReader.cookieHash("yingxiang_session=%61" + "a".repeat(63))).isEmpty();
        assertThat(AccountReader.cookieHash("yingxiang_session=" + "A".repeat(64))).isEmpty();
        assertThat(AccountReader.cookieHash(null)).isEmpty();
    }

    @Test void schemaScopeAndFlywaySafetyFlagsAreExplicit() {
        var properties = new Properties();
        properties.setProperty("migration.db-schema", "public");
        assertThatThrownBy(() -> SchemaOperations.schema(properties)).isInstanceOf(IllegalArgumentException.class);
        properties.setProperty("migration.db-schema", "yingxiang_migration_it_012345abcdef");
        assertThat(SchemaOperations.schema(properties)).isEqualTo("yingxiang_migration_it_012345abcdef");
        properties.setProperty("migration.db-schema", "yingxiang_migration;DROP SCHEMA public");
        assertThatThrownBy(() -> SchemaOperations.schema(properties)).isInstanceOf(IllegalArgumentException.class);
    }
}
