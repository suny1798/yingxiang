package cn.yingxiang.service;

import cn.yingxiang.manager.ClientTokenValidator;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.FixtureTokenTransport;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.mapper.MigrationAccounts;
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
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface PromptService {

    public static final String MODEL = "lucy-2.5";

    public static final String CONSENT = "2026-10-26-prompt-history-v1";

    public static final long RISK_MICRO = 300_000L;

    public static final long WAIT_MS = 60_000L;

    public boolean configured();

    public Map<String, Object> status(String userId);

    public void authenticate(String supplied);

    public Map<String, Object> issue(String hashed, JsonNode body, String origin);
}
