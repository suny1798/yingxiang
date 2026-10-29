package cn.yingxiang.service;

import cn.yingxiang.manager.ClientTokenValidator;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.FixtureTokenTransport;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.mapper.AccountReader;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.*;

public interface StudioFixtureService {

    public Map<String, Object> status();

    public String require(String hash);

    public void authenticate(String access);

    public Map<String, Object> issue(String hashed, JsonNode body, String origin);

    public void observe(String userId, JsonNode body);
}
