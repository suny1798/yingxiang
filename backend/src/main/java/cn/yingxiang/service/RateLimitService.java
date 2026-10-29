package cn.yingxiang.service;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.MigrationAccounts;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * M19：限流以Redis原子脚本为主，PG影子记录窗口与故障闸门。
 * Redis不可用、重启或键被淘汰时不把窗口当作零计数；新收费／生成入口保守503。
 */
@Service
@Profile("local")
public class RateLimitService implements ApplicationRunner {
    private static final DefaultRedisScript<List> COUNTER = new DefaultRedisScript<>(
            "local existed=redis.call('EXISTS',KEYS[1]);"
                    + "local count=redis.call('INCR',KEYS[1]);"
                    + "if existed==0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end;"
                    + "return {count,redis.call('PTTL',KEYS[1]),existed}", List.class);

    // 合并旧窗口与已有窗口：不叠加、不降低计数、不缩短TTL，同一脚本原子执行。
    public static final DefaultRedisScript<List> IMPORT = new DefaultRedisScript<>(
            "local old=redis.call('GET',KEYS[1]);"
            + "local count=math.max(tonumber(old or '0'),tonumber(ARGV[1]));"
            + "local ttl=math.max(redis.call('PTTL',KEYS[1]),tonumber(ARGV[2]));"
            + "redis.call('SET',KEYS[1],tostring(count),'PX',ttl);return {count,ttl}", List.class);

    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final MigrationAccounts accounts;
    private final String schema;
    private final String namespace;
    private final boolean enabled;
    private final boolean importWindows;
    private final long gateMs;

    public RateLimitService(JdbcTemplate jdbc, StringRedisTemplate redis, MigrationAccounts accounts,
                            Environment env) {
        this.jdbc = jdbc; this.redis = redis; this.accounts = accounts;
        this.schema = MigrationSupport.quotedSchema(env);
        String value = env.getRequiredProperty("migration.redis-namespace");
        if (!value.matches("yingxiang:migration:[A-Za-z0-9:_-]+")) {
            throw new IllegalArgumentException("Invalid Redis namespace");
        }
        namespace = value;
        enabled = env.getProperty("migration.redis-rate-limit-enabled", Boolean.class, false);
        importWindows = env.getProperty("migration.redis-import-windows", Boolean.class, true);
        gateMs = positive(env, "migration.redis-gate-seconds", 900L) * 1000L;
    }

    private static long positive(Environment env, String name, long fallback) {
        try {
            long value = Long.parseLong(env.getProperty(name, Long.toString(fallback)));
            return value > 0 ? value : fallback;
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    public boolean enabled() { return enabled; }

    /** 返回true表示超过上限；Redis故障或窗口丢失时抛出503，不静默放开。 */
    public boolean exceeded(String key, int maximum, long windowMs) {
        if (!enabled) return accounts.rateLimit(key, maximum, windowMs);
        long now = System.currentTimeMillis();
        gate(key, now);
        String redisKey = namespace + ":rate:" + key;
        try {
            List<?> result = redis.execute(COUNTER, List.of(redisKey), Long.toString(windowMs));
            if (result == null || result.size() != 3) throw new IllegalStateException();
            long count = ((Number) result.get(0)).longValue();
            long ttl = ((Number) result.get(1)).longValue();
            long existed = ((Number) result.get(2)).longValue();
            long until = now + Math.max(1, ttl);
            if (existed == 0) {
                Map<String, Object> shadow = shadow(key);
                if (shadow != null && MigrationSupport.number(shadow, "until") > now
                        && MigrationSupport.number(shadow, "count") > 0) {
                    gateUntil(key, MigrationSupport.number(shadow, "until"), "WINDOW_LOST");
                    throw unavailable();
                }
            }
            shadow(key, count, until);
            return count > maximum;
        } catch (BusinessFailure error) {
            throw error;
        } catch (RuntimeException error) {
            gateUntil(key, now + Math.max(windowMs, gateMs), "REDIS_UNAVAILABLE");
            throw unavailable();
        }
    }

    public void check(String key, int maximum, long windowMs) {
        if (exceeded(key, maximum, windowMs)) {
            throw new BusinessFailure("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429);
        }
    }

    /** 原子合并旧PG与Redis窗口；取较大计数及较长TTL，重复导入不叠加。 */
    public void importWindows() {
        if (!enabled || !importWindows) return;
        long now = System.currentTimeMillis();
        for (Map<String, Object> row : jdbc.queryForList("SELECT key,count,until FROM " + schema
                + "auth_rate_limits WHERE until>?", now)) {
            String key = (String) row.get("key");
            long count = MigrationSupport.number(row, "count");
            long until = MigrationSupport.number(row, "until");
            String redisKey = namespace + ":rate:" + key;
            List<?> merged = redis.execute(IMPORT, List.of(redisKey), Long.toString(count),
                    Long.toString(Math.max(1, until - System.currentTimeMillis())));
            if (merged == null || merged.size() != 2) throw unavailable();
            shadow(key, ((Number) merged.get(0)).longValue(),
                    System.currentTimeMillis() + ((Number) merged.get(1)).longValue());
        }
    }

    @Override public void run(ApplicationArguments args) {
        try {
            importWindows();
        } catch (RuntimeException ignored) {
            // 启动时Redis不可用不阻断进程；受限入口在check时保守503。
        }
    }

    private void gate(String key, long now) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT until FROM " + schema
                + "rate_limit_gates WHERE key=?", key);
        if (!rows.isEmpty() && MigrationSupport.number(rows.getFirst(), "until") > now) {
            throw unavailable();
        }
    }

    private void gateUntil(String key, long until, String reason) {
        long now = System.currentTimeMillis();
        jdbc.update("INSERT INTO " + schema + "rate_limit_gates(key,until,reason,updated_at) VALUES (?,?,?,?) "
                        + "ON CONFLICT(key) DO UPDATE SET until=GREATEST(rate_limit_gates.until,excluded.until),"
                        + "reason=excluded.reason,updated_at=excluded.updated_at",
                key, until, reason, now);
    }

    private Map<String, Object> shadow(String key) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT count,until FROM " + schema
                + "rate_limit_shadows WHERE key=?", key);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private void shadow(String key, long count, long until) {
        jdbc.update("INSERT INTO " + schema + "rate_limit_shadows(key,count,until,updated_at) VALUES (?,?,?,?) "
                        + "ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until,"
                        + "updated_at=excluded.updated_at",
                key, count, until, System.currentTimeMillis());
    }

    private static BusinessFailure unavailable() {
        return new BusinessFailure("RATE_LIMIT_UNAVAILABLE",
                "限流服务暂不可用，请稍后重试，不要重复提交。", 503);
    }
}
