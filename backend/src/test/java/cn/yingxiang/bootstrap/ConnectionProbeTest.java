package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Properties;

import static org.assertj.core.api.Assertions.*;

class ConnectionProbeTest {
    @Test void classifiesWithoutReturningRawMessagesOrSecrets() {
        assertThat(ConnectionProbe.failureCode(new SQLException("private-sentinel: server does not support SSL", "08004")))
                .isEqualTo("TLS_NOT_SUPPORTED");
        assertThat(ConnectionProbe.failureCode(new SQLException("private-sentinel", "28P01")))
                .isEqualTo("AUTHENTICATION_FAILED");
        assertThat(ConnectionProbe.failureCode(new SQLException("private-sentinel", "3D000")))
                .isEqualTo("DATABASE_MISSING");
        assertThat(ConnectionProbe.failureCode(new IllegalStateException("outer", new java.net.SocketTimeoutException("private-sentinel"))))
                .isEqualTo("CONNECTION_OR_TLS_TIMEOUT");
        assertThat(ConnectionProbe.failureCode(new IllegalStateException("private-sentinel")))
                .isEqualTo("CONNECTION_FAILED");
    }

    @Test void acceptsConfiguredProtocolAndRejectsWrongTargetsBeforeNetwork() {
        var valid = config();
        assertThatCode(() -> ConnectionProbe.validate(valid)).doesNotThrowAnyException();
        for (String[] change : new String[][] {
                {"spring.datasource.url", "jdbc:mysql://db.invalid:3306/picture"},
                {"spring.datasource.hikari.data-source-properties.sslmode", "unrecognized"},
                {"spring.data.redis.ssl.enabled", "unrecognized"},
                {"spring.data.redis.database", "1"},
                {"migration.maintenance", "false"},
                {"migration.redis-namespace", "business:*"},
                {"spring.datasource.password", "${UNRESOLVED_PASSWORD}"}
        }) {
            var unsafe = config();
            unsafe.setProperty(change[0], change[1]);
            assertThatThrownBy(() -> ConnectionProbe.validate(unsafe)).isInstanceOf(IllegalArgumentException.class);
        }
        var referenceStyle = config();
        referenceStyle.setProperty("spring.datasource.hikari.data-source-properties.sslmode", "disable");
        referenceStyle.setProperty("spring.data.redis.ssl.enabled", "false");
        assertThatCode(() -> ConnectionProbe.validate(referenceStyle)).doesNotThrowAnyException();
        assertThat(ConnectionProbe.jdbcProperties(referenceStyle).getProperty("sslmode")).isEqualTo("disable");
        referenceStyle.setProperty("spring.datasource.url", "jdbc:postgresql://db.invalid:5432/yingxiang");
        referenceStyle.setProperty("spring.datasource.username", "yingxiang");
        assertThatCode(() -> ConnectionProbe.validate(referenceStyle)).doesNotThrowAnyException();
    }

    @Test void jdbcPropertiesKeepCredentialsOutOfUrlAndEnforceReadOnly() {
        Properties source = config();
        Properties jdbc = ConnectionProbe.jdbcProperties(source);
        assertThat(jdbc.getProperty("sslmode")).isEqualTo("verify-full");
        assertThat(jdbc.getProperty("readOnly")).isEqualTo("true");
        assertThat(jdbc.getProperty("readOnlyMode")).isEqualTo("always");
        assertThat(jdbc.getProperty("socketTimeout")).isEqualTo("6");
        assertThat(source.getProperty("spring.datasource.url")).doesNotContain(source.getProperty("spring.datasource.password"));
    }

    @Test void readsYamlWithoutInterpolatingEnvironment(@TempDir Path temp) throws Exception {
        Path file = temp.resolve("application-local.yml");
        Files.writeString(file, "spring:\n  datasource:\n    password: \"literal:#@!$secret\"\n");
        assertThat(ConnectionProbe.load(file).getProperty("spring.datasource.password")).isEqualTo("literal:#@!$secret");
        assertThatThrownBy(() -> ConnectionProbe.load(temp.resolve("missing.yml"))).isInstanceOf(IllegalArgumentException.class);
    }

    private Properties config() {
        var p = new Properties();
        p.setProperty("spring.datasource.url", "jdbc:postgresql://db.invalid:5432/yingxiang_migration_test");
        p.setProperty("spring.datasource.username", "synthetic_migration");
        p.setProperty("spring.datasource.password", "synthetic-private-sentinel");
        p.setProperty("spring.datasource.hikari.data-source-properties.sslmode", "verify-full");
        p.setProperty("spring.data.redis.host", "redis.invalid");
        p.setProperty("spring.data.redis.port", "6379");
        p.setProperty("spring.data.redis.password", "synthetic-private-sentinel");
        p.setProperty("spring.data.redis.ssl.enabled", "true");
        p.setProperty("spring.data.redis.database", "0");
        p.setProperty("migration.db-schema", "yingxiang_migration");
        p.setProperty("migration.redis-namespace", "yingxiang:migration:test");
        p.setProperty("migration.maintenance", "true");
        p.setProperty("migration.allow-external-providers", "false");
        p.setProperty("migration.scenes-enabled", "false");
        p.setProperty("migration.stripe-live-enabled", "false");
        return p;
    }
}
