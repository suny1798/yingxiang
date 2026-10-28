package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** M13起共享的HTTP/JSON、时间与临时schema边界；不记录请求体、Cookie或令牌。 */
final class MigrationSupport {
    static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    private MigrationSupport() {}

    static String iso(long millis) {
        return ISO.format(Instant.ofEpochMilli(millis));
    }

    static String uuid() {
        return UUID.randomUUID().toString();
    }

    static boolean isUuid(String value) {
        return value != null && value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    }

    static String requireIsolatedSchema(JdbcTemplate jdbc, Environment env, String purpose) {
        String target = env.getRequiredProperty("migration.db-schema");
        if (!target.matches("yingxiang_migration_it_[a-f0-9]{12}")) {
            throw new IllegalStateException(purpose + " requires a temporary schema");
        }
        String owner = jdbc.queryForObject("SELECT obj_description(oid,'pg_namespace') FROM pg_namespace WHERE nspname=?", String.class, target);
        if (!("yingxiang-m10b-integration:" + target).equals(owner)) {
            throw new IllegalStateException(purpose + " schema ownership mismatch");
        }
        return '"' + target + '"' + ".";
    }

    static String quotedSchema(Environment env) {
        String target = env.getRequiredProperty("migration.db-schema");
        if (!target.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid migration schema");
        return '"' + target + '"' + ".";
    }

    static JsonNode readJson(HttpServletRequest request, JsonMapper json, int limit, boolean requireJsonContentType) {
        if (requireJsonContentType) requireJsonContentType(request);
        byte[] bytes;
        try {
            bytes = request.getInputStream().readNBytes(limit + 1);
        } catch (IOException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400);
        }
        if (bytes.length > limit) throw new BusinessFailure("BODY_TOO_LARGE", "请求内容过大。", 413);
        try {
            String input = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode body = json.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(input);
            if (body == null || !body.isObject()) throw new IllegalArgumentException();
            return body;
        } catch (RuntimeException | java.nio.charset.CharacterCodingException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400);
        }
    }

    static void requireJsonContentType(HttpServletRequest request) {
        String value = request.getContentType();
        if (value == null || !value.split(";", 2)[0].strip().equals("application/json")) {
            throw new BusinessFailure("INVALID_REQUEST", "请使用JSON请求。", 415);
        }
    }

    static void write(HttpServletResponse response, JsonMapper json, Object body, int status) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        response.setStatus(status);
        response.setContentType("application/json");
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }

    static void failure(HttpServletResponse response, JsonMapper json, Throwable error) throws IOException {
        BusinessFailure failure = error instanceof BusinessFailure expected ? expected : BusinessFailure.unavailable();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", Map.of("code", failure.code, "message", failure.getMessage(), "retryable", false));
        body.put("requestId", response.getHeader("X-Request-Id"));
        write(response, json, body, failure.status);
    }

    static Map<String, Object> body(Object... pairs) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int index = 0; index < pairs.length; index += 2) value.put((String) pairs[index], pairs[index + 1]);
        return value;
    }

    static long number(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : 0;
    }

    static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
