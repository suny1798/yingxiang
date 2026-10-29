package cn.yingxiang.mapper;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
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
    private final JdbcTemplate jdbc;
    private final String schema;

    public AccountReader(JdbcTemplate jdbc, Environment env) {
        this.jdbc = jdbc;
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
        Integer version = jdbc.queryForObject("SELECT count(*) FROM " + schema
                + "flyway_schema_history WHERE version='1' AND success", Integer.class);
        if (version == null || version != 1) throw new IllegalStateException("Schema not migrated");
        Integer readable = jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? "
                + "AND table_name IN ('users','auth_sessions','entitlement_grants','usage_attempts','flyway_schema_history')", Integer.class,
                schema.substring(1, schema.length() - 2));
        if (readable == null || readable != 5) throw new IllegalStateException("Account schema incomplete");
        List<Map<String, Object>> found = hashed.isEmpty() ? List.of() : jdbc.queryForList(
                "SELECT u.id,u.username,u.created_at,u.role FROM " + schema + "users u JOIN " + schema
                        + "auth_sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.disabled=0", hashed, System.currentTimeMillis());
        if (found.isEmpty()) return emptyView();
        Map<String, Object> user = found.getFirst();
        String id = (String) user.get("id");
        var balances = jdbc.queryForList("SELECT seconds,sum(total-revoked) AS quota,"
                + "sum(total-reserved-used-revoked) AS remaining FROM " + schema
                + "entitlement_grants WHERE user_id=? AND environment='real_usage' GROUP BY seconds", id);
        List<Map<String, Object>> durations = new ArrayList<>();
        for (int seconds : List.of(15, 30, 60)) {
            Map<String, Object> balance = balances.stream().filter(row -> number(row, "seconds") == seconds).findFirst().orElse(Map.of());
            durations.add(Map.of("seconds", seconds, "limit", number(balance, "quota"), "remaining", number(balance, "remaining")));
        }
        var historyRows = jdbc.queryForList("SELECT id,created_at,seconds,account_state,outcome FROM " + schema
                + "usage_attempts WHERE user_id=? AND scene='studio' AND account_state IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 20", id);
        List<Map<String, Object>> history = new ArrayList<>();
        for (var row : historyRows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id")); item.put("createdAt", ISO.format(Instant.ofEpochMilli(number(row, "created_at"))));
            item.put("durationSec", row.get("seconds")); item.put("state", row.get("account_state"));
            if (row.get("outcome") instanceof String outcome && !outcome.isEmpty()) item.put("outcome", outcome);
            history.add(item);
        }
        boolean review = Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM " + schema
                + "usage_attempts WHERE user_id=? AND scene='studio' AND seconds=15 AND account_state='review')", Boolean.class, id));
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
