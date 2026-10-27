package cn.yingxiang.bootstrap;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.SocketOptions;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.FileSystemResource;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/** 显式执行的只读连接CLI，不启动Web、不运行迁移、不输出原始异常。 */
public final class ConnectionProbe {
    private ConnectionProbe() {}

    public static void main(String[] args) {
        java.util.logging.Logger.getLogger("").setLevel(java.util.logging.Level.OFF);
        var json = JsonMapper.builder().build();
        Map<String, Object> report = new LinkedHashMap<>();
        int exit = 2;
        try {
            if (args.length != 1) throw new IllegalArgumentException();
            Properties config = load(Path.of(args[0]));
            validate(config);
            Map<String, Object> pg = postgres(config);
            Map<String, Object> redis = redis(config);
            report.put("postgresql", pg);
            report.put("redis", redis);
            report.put("businessDataRead", false);
            report.put("businessDataWritten", false);
            report.put("namespaceWritePermissionVerified", false);
            exit = Boolean.TRUE.equals(pg.get("ok")) && Boolean.TRUE.equals(redis.get("ok")) ? 0 : 1;
        } catch (Exception ignored) {
            report.put("configuration", "INVALID_OR_UNREADABLE");
        }
        System.out.println(json.writeValueAsString(report));
        System.exit(exit);
    }

    static Properties load(Path path) throws Exception {
        if (!Files.isRegularFile(path) || Files.isSymbolicLink(path)) throw new IllegalArgumentException();
        Properties config = new Properties();
        var sources = new YamlPropertySourceLoader().load("local-probe", new FileSystemResource(path));
        if (sources.size() != 1) throw new IllegalArgumentException();
        var source = (org.springframework.core.env.EnumerablePropertySource<?>) sources.getFirst();
        for (String name : source.getPropertyNames()) {
            Object value = source.getProperty(name);
            if (value != null) config.setProperty(name, value.toString());
        }
        return config;
    }

    static void validate(Properties config) {
        for (String key : Set.of("spring.datasource.url", "spring.datasource.username", "spring.datasource.password",
                "spring.data.redis.host", "spring.data.redis.port", "spring.data.redis.password", "migration.db-schema")) {
            required(config, key);
        }
        String url = required(config, "spring.datasource.url");
        if (!url.matches("jdbc:postgresql://(?:[A-Za-z0-9.-]+|\\[[0-9a-fA-F:]+]):[0-9]+/[A-Za-z0-9_%.-]+")
                || !required(config, "migration.db-schema").matches("[A-Za-z_][A-Za-z0-9_]*")
                || !required(config, "migration.db-schema").toLowerCase(Locale.ROOT).contains("migration")
                || !Set.of("verify-full", "disable").contains(config.getProperty("spring.datasource.hikari.data-source-properties.sslmode", ""))
                || !Set.of("true", "false").contains(config.getProperty("spring.data.redis.ssl.enabled", "false"))
                || !"0".equals(config.getProperty("spring.data.redis.database"))
                || !required(config, "migration.redis-namespace").matches("yingxiang:migration:[A-Za-z0-9:_-]+")
                || !"true".equals(config.getProperty("migration.maintenance"))) {
            throw new IllegalArgumentException();
        }
        for (String key : Set.of("migration.allow-external-providers", "migration.scenes-enabled", "migration.stripe-live-enabled")) {
            if (!"false".equals(config.getProperty(key))) throw new IllegalArgumentException();
        }
        String host = required(config, "spring.data.redis.host");
        if (!host.matches("[A-Za-z0-9.:-]+")) throw new IllegalArgumentException();
        int port = Integer.parseInt(required(config, "spring.data.redis.port"));
        if (port < 1 || port > 65535) throw new IllegalArgumentException();
    }

    static Properties jdbcProperties(Properties config) {
        var properties = new Properties();
        properties.setProperty("user", required(config, "spring.datasource.username"));
        properties.setProperty("password", required(config, "spring.datasource.password"));
        properties.setProperty("sslmode", config.getProperty("spring.datasource.hikari.data-source-properties.sslmode"));
        String cert = config.getProperty("spring.datasource.hikari.data-source-properties.sslrootcert", "");
        if (!cert.isBlank()) properties.setProperty("sslrootcert", cert);
        properties.setProperty("connectTimeout", "5");
        properties.setProperty("socketTimeout", "6");
        properties.setProperty("loginTimeout", "8");
        properties.setProperty("readOnly", "true");
        properties.setProperty("readOnlyMode", "always");
        return properties;
    }

    private static Map<String, Object> postgres(Properties config) {
        long start = System.nanoTime();
        try (var connection = DriverManager.getConnection(required(config, "spring.datasource.url"), jdbcProperties(config))) {
            connection.setReadOnly(true);
            connection.setAutoCommit(false);
            try (var statement = connection.prepareStatement("SELECT current_setting('server_version_num')::int, "
                    + "EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ?), "
                    + "current_setting('transaction_read_only') = 'on'")) {
                statement.setString(1, required(config, "migration.db-schema"));
                statement.setQueryTimeout(5);
                try (var rows = statement.executeQuery()) {
                    if (!rows.next()) throw new SQLException();
                    boolean schema = rows.getBoolean(2);
                    boolean readOnly = rows.getBoolean(3);
                    var result = result(schema && readOnly, !readOnly ? "READ_ONLY_NOT_CONFIRMED"
                            : schema ? "READ_ONLY_CONNECTED" : "SCHEMA_MISSING", start);
                    result.put("serverVersionNumber", rows.getInt(1));
                    result.put("schemaExists", schema);
                    result.put("readOnlyTransaction", readOnly);
                    connection.rollback();
                    return result;
                }
            }
        } catch (Exception error) {
            return result(false, failureCode(error), start);
        }
    }

    private static Map<String, Object> redis(Properties config) {
        long start = System.nanoTime();
        RedisClient client = null;
        try {
            var builder = RedisURI.Builder.redis(required(config, "spring.data.redis.host"),
                            Integer.parseInt(required(config, "spring.data.redis.port")))
                    .withSsl(Boolean.parseBoolean(config.getProperty("spring.data.redis.ssl.enabled", "false")))
                    .withVerifyPeer(true).withTimeout(Duration.ofSeconds(6));
            String username = config.getProperty("spring.data.redis.username", "");
            char[] password = required(config, "spring.data.redis.password").toCharArray();
            if (username.isBlank()) builder.withPassword(password);
            else builder.withAuthentication(username, password);
            client = RedisClient.create(builder.build());
            client.setOptions(ClientOptions.builder().autoReconnect(false)
                    .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofSeconds(5)).build()).build());
            try (var connection = client.connect()) {
                return result("PONG".equals(connection.sync().ping()), "AUTHENTICATED_PING", start);
            }
        } catch (Exception error) {
            return result(false, failureCode(error), start);
        } finally {
            if (client != null) {
                try { client.shutdown(Duration.ZERO, Duration.ofSeconds(2)); }
                catch (Exception ignored) { /* 外层进程有截止时间；不输出驱动诊断对象。 */ }
            }
        }
    }

    static String failureCode(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            String message = String.valueOf(cause.getMessage()).toLowerCase(Locale.ROOT);
            if (message.contains("does not support ssl")) return "TLS_NOT_SUPPORTED";
            if (cause instanceof SQLException sql) {
                if (sql.getSQLState() != null && sql.getSQLState().startsWith("28")) return "AUTHENTICATION_FAILED";
                if ("3D000".equals(sql.getSQLState())) return "DATABASE_MISSING";
                if ("42501".equals(sql.getSQLState())) return "PERMISSION_DENIED";
            }
            if (message.contains("wrongpass") || message.contains("noauth")) return "AUTHENTICATION_FAILED";
            if (cause instanceof java.net.UnknownHostException) return "NAME_RESOLUTION_FAILED";
            if (cause instanceof java.net.SocketTimeoutException || message.contains("timed out") || message.contains("timeout")) return "CONNECTION_OR_TLS_TIMEOUT";
            if (cause instanceof javax.net.ssl.SSLException) return "TLS_HANDSHAKE_FAILED";
        }
        return "CONNECTION_FAILED";
    }

    private static String required(Properties config, String key) {
        String value = config.getProperty(key);
        if (value == null || value.isBlank() || value.contains("${")) throw new IllegalArgumentException();
        return value;
    }

    private static Map<String, Object> result(boolean ok, String code, long start) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", ok);
        result.put("code", code);
        result.put("elapsedMs", (System.nanoTime() - start) / 1_000_000);
        return result;
    }
}
