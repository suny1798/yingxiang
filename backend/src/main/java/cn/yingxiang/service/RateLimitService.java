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

public interface RateLimitService extends ApplicationRunner {

    // 合并旧窗口与已有窗口：不叠加、不降低计数、不缩短TTL，同一脚本原子执行。
    public static final DefaultRedisScript<List> IMPORT = new DefaultRedisScript<>(
                "local old=redis.call('GET',KEYS[1]);"
                + "local count=math.max(tonumber(old or '0'),tonumber(ARGV[1]));"
                + "local ttl=math.max(redis.call('PTTL',KEYS[1]),tonumber(ARGV[2]));"
                + "redis.call('SET',KEYS[1],tostring(count),'PX',ttl);return {count,ttl}", List.class);

    public boolean enabled();

    public boolean exceeded(String key, int maximum, long windowMs);

    public void check(String key, int maximum, long windowMs);

    public void importWindows();
}
