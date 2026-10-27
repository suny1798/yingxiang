package cn.yingxiang.bootstrap;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
@Profile("local")
public class AccountAuthService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long SESSION_MS = 7L * 24 * 60 * 60 * 1000;
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final AccountReader reader;
    private final TransactionTemplate independent;
    private final String schema;

    public AccountAuthService(JdbcTemplate jdbc, StringRedisTemplate redis, AccountReader reader,
                              PlatformTransactionManager manager, Environment env) {
        this.jdbc = jdbc; this.redis = redis; this.reader = reader;
        String target = env.getRequiredProperty("migration.db-schema");
        if (!target.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid schema");
        schema = '"' + target + '"' + ".";
        independent = new TransactionTemplate(manager);
        independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        independent.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        independent.setReadOnly(false); independent.setTimeout(10);
    }

    public Result authenticate(String username, String password, boolean register) {
        validate(username, password);
        String name = username.toLowerCase(Locale.ROOT);
        try {
            String pong = redis.execute((RedisCallback<String>) connection -> connection.ping());
            if (!"PONG".equals(pong)) throw BusinessFailure.unavailable();
        } catch (RuntimeException error) { throw BusinessFailure.unavailable(); }
        boolean denied = Boolean.TRUE.equals(independent.execute(status -> {
            long now = System.currentTimeMillis();
            if (rate("auth:global", 60, 15 * 60_000L, now)) return true;
            if (rate("auth:" + name, 10, 15 * 60_000L, now)) return true;
            return register && rate("signup", 20, 60 * 60_000L, now);
        }));
        if (denied) throw new BusinessFailure("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429);
        var users = jdbc.queryForList("SELECT id,salt,password_hash FROM " + schema + "users WHERE username=?", name);
        Map<String, Object> existing = users.isEmpty() ? null : users.getFirst();
        if (register && existing != null) throw exists();
        String salt = register ? random(16) : existing == null ? "yingxiang-nonexistent-account" : (String) existing.get("salt");
        // 没有外层事务：scrypt不占连接，不持有数据库锁。
        String encoded = CompatiblePassword.hash(password, salt);
        if (!register && (existing == null || !CompatiblePassword.equal(encoded, (String) existing.get("password_hash")))) {
            throw new BusinessFailure("INVALID_CREDENTIALS", "账号或密码不正确。", 401);
        }
        String token = random(32);
        try {
            return independent.execute(status -> {
                long now = System.currentTimeMillis();
                String id;
                if (register) {
                    id = UUID.randomUUID().toString();
                    jdbc.update("INSERT INTO " + schema + "users(id,username,salt,password_hash,created_at) VALUES (?,?,?,?,?)", id, name, salt, encoded, now);
                    String grant = UUID.randomUUID().toString();
                    jdbc.update("INSERT INTO " + schema + "entitlement_grants(id,user_id,seconds,environment,source,source_key,total) VALUES (?,?,15,'real_usage','free',?,1)", grant, id, "signup:" + id);
                    jdbc.update("INSERT INTO " + schema + "entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) VALUES (?,?,?,'grant',1,?)", UUID.randomUUID().toString(), grant, "grant:signup:" + id, now);
                } else {
                    id = (String) existing.get("id");
                    var current = jdbc.queryForList("SELECT disabled,password_hash FROM " + schema + "users WHERE id=? FOR UPDATE", id);
                    if (current.isEmpty() || !CompatiblePassword.equal(encoded, (String) current.getFirst().get("password_hash"))) {
                        throw new BusinessFailure("INVALID_CREDENTIALS", "账号或密码不正确。", 401);
                    }
                    if (((Number) current.getFirst().get("disabled")).intValue() != 0) throw new BusinessFailure("ACCOUNT_DISABLED", "账号已暂停，请联系项目维护者。", 403);
                }
                String hashed = AccountReader.cookieHash("yingxiang_session=" + token);
                jdbc.update("INSERT INTO " + schema + "auth_sessions(hash,user_id,expires_at) VALUES (?,?,?)", hashed, id, now + SESSION_MS);
                return new Result(reader.read(hashed), token);
            });
        } catch (DataIntegrityViolationException error) { throw exists(); }
    }

    public void logout(String hashed) {
        independent.executeWithoutResult(status -> jdbc.update("DELETE FROM " + schema + "auth_sessions WHERE hash=?", hashed));
    }

    private boolean rate(String key, int maximum, long duration, long now) {
        Integer count = jdbc.queryForObject("INSERT INTO " + schema + "auth_rate_limits AS r(key,count,until) VALUES (?,1,?) "
                + "ON CONFLICT(key) DO UPDATE SET count=CASE WHEN r.until<=? THEN 1 ELSE r.count+1 END, "
                + "until=CASE WHEN r.until<=? THEN ? ELSE r.until END RETURNING count", Integer.class, key, now + duration, now, now, now + duration);
        return count != null && count > maximum;
    }

    public static void validate(String username, String password) {
        if (username == null || !username.matches("[a-zA-Z0-9_]{3,24}") || password == null || password.length() < 8 || password.length() > 128) {
            throw new BusinessFailure("INVALID_ACCOUNT", "账号需为3—24位字母、数字或下划线，密码需为8—128位。", 400);
        }
    }
    private static BusinessFailure exists() { return new BusinessFailure("ACCOUNT_EXISTS", "这个账号已注册，请直接登录或换一个账号。", 409); }
    private static String random(int length) { byte[] bytes = new byte[length]; RANDOM.nextBytes(bytes); return HexFormat.of().formatHex(bytes); }
    // 避免record默认toString把token写入后续诊断。
    public static final class Result {
        final Map<String, Object> view;
        final String token;
        Result(Map<String, Object> view, String token) { this.view = view; this.token = token; }
    }
}
