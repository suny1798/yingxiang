package cn.yingxiang.service.impl;

import cn.yingxiang.service.AccountAuthService;
import cn.yingxiang.common.CompatiblePassword;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.AccountAuthMapper;
import cn.yingxiang.mapper.AccountReader;
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
import cn.yingxiang.service.RateLimitService;

@Service
@Profile("local")
public class AccountAuthServiceImpl implements AccountAuthService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private static final long SESSION_MS = 7L * 24 * 60 * 60 * 1000;

    private final JdbcTemplate jdbc;

    private final AccountAuthMapper accounts;

    private final StringRedisTemplate redis;

    private final AccountReader reader;

    private final RateLimitService rateLimit;

    private final TransactionTemplate independent;

    private final String schema;

    public AccountAuthServiceImpl(JdbcTemplate jdbc, AccountAuthMapper accounts, StringRedisTemplate redis,
                                  AccountReader reader, RateLimitService rateLimit, PlatformTransactionManager manager,
                                  Environment env) {
            this.jdbc = jdbc; this.accounts = accounts; this.redis = redis; this.reader = reader; this.rateLimit = rateLimit;
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
            if (!rateLimit.enabled()) {
                try {
                    String pong = redis.execute((RedisCallback<String>) connection -> connection.ping());
                    if (!"PONG".equals(pong)) throw BusinessFailure.unavailable();
                } catch (RuntimeException error) { throw BusinessFailure.unavailable(); }
            }
            rateLimit.check("auth:global", 60, 15 * 60_000L);
            rateLimit.check("auth:" + name, 10, 15 * 60_000L);
            if (register) rateLimit.check("signup", 20, 60 * 60_000L);
            Map<String, Object> existing = accounts.findByUsername(schema, name);
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
                        accounts.insertUser(schema, id, name, salt, encoded, now);
                        String grant = UUID.randomUUID().toString();
                        accounts.insertFreeGrant(schema, grant, id, "signup:" + id);
                        accounts.insertGrantEntry(schema, UUID.randomUUID().toString(), grant,
                                "grant:signup:" + id, now);
                    } else {
                        id = (String) existing.get("id");
                        Map<String, Object> current = accounts.lockUser(schema, id);
                        if (current == null || !CompatiblePassword.equal(encoded, (String) current.get("password_hash"))) {
                            throw new BusinessFailure("INVALID_CREDENTIALS", "账号或密码不正确。", 401);
                        }
                        if (((Number) current.get("disabled")).intValue() != 0) throw new BusinessFailure("ACCOUNT_DISABLED", "账号已暂停，请联系项目维护者。", 403);
                    }
                    String hashed = AccountReader.cookieHash("yingxiang_session=" + token);
                    accounts.insertSession(schema, hashed, id, now + SESSION_MS);
                    return new Result(reader.read(hashed), token);
                });
            } catch (DataIntegrityViolationException error) { throw exists(); }
        }

    public void logout(String hashed) {
            independent.executeWithoutResult(status -> accounts.deleteSession(schema, hashed));
        }



    public static void validate(String username, String password) {
            if (username == null || !username.matches("[a-zA-Z0-9_]{3,24}") || password == null || password.length() < 8 || password.length() > 128) {
                throw new BusinessFailure("INVALID_ACCOUNT", "账号需为3—24位字母、数字或下划线，密码需为8—128位。", 400);
            }
        }

    private static BusinessFailure exists() { return new BusinessFailure("ACCOUNT_EXISTS", "这个账号已注册，请直接登录或换一个账号。", 409); }

    private static String random(int length) { byte[] bytes = new byte[length]; RANDOM.nextBytes(bytes); return HexFormat.of().formatHex(bytes); }
}
