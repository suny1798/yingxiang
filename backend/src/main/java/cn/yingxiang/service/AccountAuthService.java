package cn.yingxiang.service;

import cn.yingxiang.service.impl.AccountAuthServiceImpl;
import cn.yingxiang.common.CompatiblePassword;
import cn.yingxiang.exception.BusinessFailure;
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

public interface AccountAuthService {

    public Result authenticate(String username, String password, boolean register);

    public void logout(String hashed);

    public static void validate(String username, String password) { AccountAuthServiceImpl.validate(username, password); }

    // 避免record默认toString把token写入后续诊断。
    public static final class Result {
    public final Map<String, Object> view;
    public final String token;
    public Result(Map<String, Object> view, String token) { this.view = view; this.token = token; }
        }
}
