package cn.yingxiang.mapper;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/** M13起复用的会话身份与账务写入原语；SQL 由 MyBatis-Plus Mapper 承载。 */
@Service
@Profile("local")
public class MigrationAccounts {
    private final UserMapper users;
    private final String schema;

    public MigrationAccounts(UserMapper users, Environment env) {
        this.users = users;
        this.schema = MigrationSupport.quotedSchema(env);
    }

    public record User(String id, String username, String role, long createdAt) {}

    /** 首个匹配Cookie已在AccountReader.cookieHash完成；此处只按摘要查有效会话。 */
    public User optional(String hashed) {
        if (hashed == null || hashed.isEmpty()) return null;
        Map<String, Object> row = users.optional(schema, hashed, System.currentTimeMillis());
        if (row == null) return null;
        return new User((String) row.get("id"), (String) row.get("username"), (String) row.get("role"),
                MigrationSupport.number(row, "created_at"));
    }

    public User require(String hashed) {
        User user = optional(hashed);
        if (user == null) throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
        return user;
    }

    public User byId(String id) {
        Map<String, Object> row = users.byId(schema, id);
        if (row == null) return null;
        return new User((String) row.get("id"), (String) row.get("username"), (String) row.get("role"),
                MigrationSupport.number(row, "created_at"));
    }

    /** 与旧rate_limit同事务：返回true表示超过上限；拒绝时由调用方回滚计数。 */
    public boolean rateLimit(String key, int maximum, long windowMs) {
        long now = System.currentTimeMillis();
        Integer count = users.rateLimit(schema, key, now, now + windowMs);
        return count != null && count > maximum;
    }

    public String grant(String userId, int seconds, int total, String source, String sourceKey, String environment) {
        String ident = UUID.randomUUID().toString();
        users.insertGrant(schema, ident, userId, seconds, environment, source, sourceKey, total);
        if (total > 0) {
            users.insertGrantEntry(schema, UUID.randomUUID().toString(), ident, "grant:" + sourceKey, total,
                    System.currentTimeMillis());
        }
        return ident;
    }

    public String schema() { return schema; }
}
