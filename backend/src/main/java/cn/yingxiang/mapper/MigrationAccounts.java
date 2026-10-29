package cn.yingxiang.mapper;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/** M13起复用的会话身份与账务写入原语；只读写迁移schema。 */
@Service
@Profile("local")
public class MigrationAccounts {
    private final JdbcTemplate jdbc;
    private final String schema;

    public MigrationAccounts(JdbcTemplate jdbc, Environment env) {
        this.jdbc = jdbc;
        this.schema = MigrationSupport.quotedSchema(env);
    }

    public record User(String id, String username, String role, long createdAt) {}

    /** 首个匹配Cookie已在AccountReader.cookieHash完成；此处只按摘要查有效会话。 */
    public User optional(String hashed) {
        if (hashed == null || hashed.isEmpty()) return null;
        List<java.util.Map<String, Object>> rows = jdbc.queryForList("SELECT u.id,u.username,u.role,u.created_at FROM "
                + schema + "users u JOIN " + schema + "auth_sessions s ON s.user_id=u.id "
                + "WHERE s.hash=? AND s.expires_at>? AND u.disabled=0", hashed, System.currentTimeMillis());
        if (rows.isEmpty()) return null;
        var row = rows.getFirst();
        return new User((String) row.get("id"), (String) row.get("username"), (String) row.get("role"),
                MigrationSupport.number(row, "created_at"));
    }

    public User require(String hashed) {
        User user = optional(hashed);
        if (user == null) throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
        return user;
    }

    public User byId(String id) {
        var rows = jdbc.queryForList("SELECT id,username,role,created_at FROM " + schema + "users WHERE id=?", id);
        if (rows.isEmpty()) return null;
        var row = rows.getFirst();
        return new User((String) row.get("id"), (String) row.get("username"), (String) row.get("role"),
                MigrationSupport.number(row, "created_at"));
    }

    /** 与旧rate_limit同事务：返回true表示超过上限；拒绝时由调用方回滚计数。 */
    public boolean rateLimit(String key, int maximum, long windowMs) {
        long now = System.currentTimeMillis();
        Integer count = jdbc.queryForObject("INSERT INTO " + schema + "auth_rate_limits AS r(key,count,until) VALUES (?,1,?) "
                + "ON CONFLICT(key) DO UPDATE SET count=CASE WHEN r.until<=? THEN 1 ELSE r.count+1 END, "
                + "until=CASE WHEN r.until<=? THEN ? ELSE r.until END RETURNING count", Integer.class,
                key, now + windowMs, now, now, now + windowMs);
        return count != null && count > maximum;
    }

    public String grant(String userId, int seconds, int total, String source, String sourceKey, String environment) {
        String ident = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO " + schema + "entitlement_grants(id,user_id,seconds,environment,source,source_key,total) "
                + "VALUES (?,?,?,?,?,?,?)", ident, userId, seconds, environment, source, sourceKey, total);
        if (total > 0) {
            jdbc.update("INSERT INTO " + schema + "entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
                    + "VALUES (?,?,?,'grant',?,?)", UUID.randomUUID().toString(), ident, "grant:" + sourceKey, total,
                    System.currentTimeMillis());
        }
        return ident;
    }

    public String schema() { return schema; }
}
