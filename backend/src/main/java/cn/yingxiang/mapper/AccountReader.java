package cn.yingxiang.mapper;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@Profile("local")
public class AccountReader {
    private static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    private final AccountQueryMapper queries;
    private final String schema;

    public AccountReader(AccountQueryMapper queries, Environment env) {
        this.queries = queries;
        String value = env.getRequiredProperty("migration.db-schema");
        if (!value.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid migration schema");
        schema = '"' + value + '"' + ".";
    }

    /** 首个匹配Cookie、不解码，兼容Node/Python；只返回摘要，永不记录token。 */
    public static String cookieHash(String header) {
        if (header == null) return "";
        for (String item : header.split(";", -1)) {
            String trimmed = item.strip();
            if (trimmed.startsWith("yingxiang_session=")) {
                String token = trimmed.substring("yingxiang_session=".length());
                if (!token.matches("[a-f0-9]{64}")) return "";
                try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
                catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(); }
            }
        }
        return "";
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> read(String hashed) {
        Integer version = queries.flywayV1(schema);
        if (version == null || version != 1) throw new IllegalStateException("Schema not migrated");
        Integer readable = queries.readableTables(schema.substring(1, schema.length() - 2));
        if (readable == null || readable != 5) throw new IllegalStateException("Account schema incomplete");
        Map<String, Object> user = hashed.isEmpty() ? null : queries.sessionUser(schema, hashed, System.currentTimeMillis());
        if (user == null) return emptyView();
        String id = (String) user.get("id");
        List<Map<String, Object>> balances = queries.balances(schema, id);
        List<Map<String, Object>> durations = new ArrayList<>();
        for (int seconds : List.of(15, 30, 60)) {
            Map<String, Object> balance = balances.stream().filter(row -> number(row, "seconds") == seconds).findFirst().orElse(Map.of());
            durations.add(Map.of("seconds", seconds, "limit", number(balance, "quota"), "remaining", number(balance, "remaining")));
        }
        List<Map<String, Object>> historyRows = queries.studioHistory(schema, id);
        List<Map<String, Object>> history = new ArrayList<>();
        for (var row : historyRows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id")); item.put("createdAt", ISO.format(Instant.ofEpochMilli(number(row, "created_at"))));
            item.put("durationSec", row.get("seconds")); item.put("state", row.get("account_state"));
            if (row.get("outcome") instanceof String outcome && !outcome.isEmpty()) item.put("outcome", outcome);
            history.add(item);
        }
        boolean review = queries.review(schema, id);
        long remaining = number(durations.getFirst(), "remaining");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", Map.of("id", id, "username", user.get("username"), "createdAt", ISO.format(Instant.ofEpochMilli(number(user, "created_at"))), "role", user.get("role")));
        result.put("trial", remaining > 0 ? "ready" : review ? "review" : "used");
        result.put("trialLimit", number(durations.getFirst(), "limit")); result.put("trialRemaining", remaining);
        result.put("durations", durations); result.put("history", history);
        return result;
    }

    public static Map<String, Object> emptyView() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", null); result.put("trial", null); result.put("trialLimit", 0); result.put("trialRemaining", 0);
        result.put("durations", List.of(Map.of("seconds", 15, "limit", 0, "remaining", 0),
                Map.of("seconds", 30, "limit", 0, "remaining", 0), Map.of("seconds", 60, "limit", 0, "remaining", 0)));
        result.put("history", List.of());
        return result;
    }

    private static long number(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : 0;
    }
}
