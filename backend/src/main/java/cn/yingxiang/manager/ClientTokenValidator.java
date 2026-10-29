package cn.yingxiang.manager;

import tools.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

/** 纯校验，不记录上游对象，不向异常写入任何凭据。收到完整响应后再传入时间。 */
public final class ClientTokenValidator {
    private ClientTokenValidator() {}

    public static void validate(JsonNode token, String model, String origin, int seconds,
                                String permanentKey, long receivedAt) {
        JsonNode key = field(token, "apiKey");
        if (key == null || !key.isString() || key.asString().codePointCount(0, key.asString().length()) < 10
                || key.asString().equals(permanentKey)) reject("INVALID_TOKEN_KEY");
        long expiry;
        try {
            JsonNode value = field(token, "expiresAt");
            if (value == null || !value.isString()) throw new IllegalArgumentException();
            expiry = OffsetDateTime.parse(value.asString()).toInstant().toEpochMilli();
        } catch (DateTimeParseException | ArithmeticException | IllegalArgumentException error) {
            throw new InvalidToken("INVALID_TOKEN_EXPIRY");
        }
        if (expiry <= receivedAt) reject("TOKEN_EXPIRED");
        // 请求10秒TTL，兼容既有5秒时钟裕量；绝不能以发请求时刻放宽长时凭据。
        if (BigDecimal.valueOf(expiry).subtract(BigDecimal.valueOf(receivedAt)).compareTo(BigDecimal.valueOf(15_000)) > 0)
            reject("INVALID_TOKEN_TTL");
        JsonNode permissions = field(token, "permissions");
        if (!singleton(field(permissions, "models"), model)) reject("TOKEN_MODEL_MISMATCH");
        if (!singleton(field(permissions, "origins"), origin)) reject("TOKEN_ORIGIN_MISMATCH");
        JsonNode duration = field(field(field(token, "constraints"), "realtime"), "maxSessionDuration");
        if (duration == null || !duration.isNumber()
                || !Double.isFinite(duration.asDouble())
                || duration.decimalValue().compareTo(BigDecimal.valueOf(seconds)) != 0) reject("TOKEN_DURATION_MISMATCH");
    }

    private static JsonNode field(JsonNode node, String key) {
        return node != null && node.isObject() ? node.get(key) : null;
    }
    private static boolean singleton(JsonNode node, String value) {
        return node != null && node.isArray() && node.size() == 1 && node.get(0).isString() && node.get(0).asString().equals(value);
    }
    private static void reject(String code) { throw new InvalidToken(code); }

    /** 仅固定分类供内部诊断；Web签发层统一折叠为TOKEN_RESULT_UNKNOWN。 */
    public static final class InvalidToken extends RuntimeException {
        public final String code;
        private InvalidToken(String code) { super(code); this.code = code; }
    }
}
