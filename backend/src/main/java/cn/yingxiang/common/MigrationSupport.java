package cn.yingxiang.common;

import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.exception.ErrorCode;
import cn.yingxiang.config.RuntimePolicy;
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
public final class MigrationSupport {
    public static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    private MigrationSupport() {}

    public static String iso(long millis) {
        return ISO.format(Instant.ofEpochMilli(millis));
    }

    public static String uuid() {
        return UUID.randomUUID().toString();
    }

    public static boolean isUuid(String value) {
        return value != null && value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    }

    public static String requireIsolatedSchema(JdbcTemplate jdbc, Environment env, String purpose) {
        String target = env.getRequiredProperty("migration.db-schema");
        if (RuntimePolicy.runtime(env)) {
            if (!"yingxiang_migration".equals(target)) throw new IllegalStateException("Runtime requires the designated schema");
            return quotedSchema(env);
        }
        if (!target.matches("yingxiang_migration_it_[a-f0-9]{12}")) {
            throw new IllegalStateException(purpose + " requires a temporary schema");
        }
        String owner = jdbc.queryForObject("SELECT obj_description(oid,'pg_namespace') FROM pg_namespace WHERE nspname=?", String.class, target);
        if (!("yingxiang-m10b-integration:" + target).equals(owner)) {
            throw new IllegalStateException(purpose + " schema ownership mismatch");
        }
        return '"' + target + '"' + ".";
    }

    public static String quotedSchema(Environment env) {
        String target = env.getRequiredProperty("migration.db-schema");
        if (!target.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid migration schema");
        return '"' + target + '"' + ".";
    }

    public static JsonNode readJson(HttpServletRequest request, JsonMapper json, int limit, boolean requireJsonContentType) {
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

    public static byte[] readBytes(HttpServletRequest request, int limit, String tooLargeCode, String tooLargeMessage) {
        byte[] bytes;
        try {
            bytes = request.getInputStream().readNBytes(limit + 1);
        } catch (IOException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400);
        }
        if (bytes.length > limit) throw new BusinessFailure(tooLargeCode, tooLargeMessage, 413);
        return bytes;
    }

    public static void requireJsonContentType(HttpServletRequest request) {        String value = request.getContentType();
        if (value == null || !value.split(";", 2)[0].strip().equals("application/json")) {
            throw new BusinessFailure("INVALID_REQUEST", "请使用JSON请求。", 415);
        }
    }

    /** 原始 JSON 写出；仅用于非业务包体的兼容场景。 */
    public static void write(HttpServletResponse response, JsonMapper json, Object body, int status) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        response.setStatus(status);
        response.setContentType("application/json");
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }

    /** 成功响应，统一包装为 code/data/message。 */
    public static void ok(HttpServletResponse response, JsonMapper json, Object data) throws IOException {
        ok(response, json, data, 200);
    }

    /** 成功响应，可指定 HTTP 状态。 */
    public static void ok(HttpServletResponse response, JsonMapper json, Object data, int status) throws IOException {
        byte[] bytes = json.writeValueAsBytes(envelope(response, ResultUtils.success(data)));
        response.setStatus(status);
        response.setContentType("application/json");
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }

    /** 失败响应，统一包装为 code/data/message，并保留细分业务原因。 */
    public static void failure(HttpServletResponse response, JsonMapper json, Throwable error) throws IOException {
        BusinessFailure failure = error instanceof BusinessFailure expected ? expected : BusinessFailure.unavailable();
        BaseResponse<?> body = ResultUtils.error(ErrorCode.fromStatus(failure.getStatus()), failure.getMessage(),
                failure.getCode());
        write(response, json, envelope(response, body), failure.getStatus());
    }

    private static BaseResponse<?> envelope(HttpServletResponse response, BaseResponse<?> body) {
        body.setRequestId(response.getHeader("X-Request-Id"));
        return body;
    }

    public static Map<String, Object> body(Object... pairs) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int index = 0; index < pairs.length; index += 2) value.put((String) pairs[index], pairs[index + 1]);
        return value;
    }

    public static long number(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : 0;
    }

    public static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
