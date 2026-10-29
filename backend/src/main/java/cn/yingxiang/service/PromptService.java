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

/** M16：实时编辑门禁、预算预留与短期令牌；suny例外只按配置的用户名生效。 */
@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.prompt-enabled", havingValue = "true")
public class PromptService {
    public static final String MODEL = "lucy-2.5";
    public static final String CONSENT = "2026-10-26-prompt-history-v1";
    public static final long RISK_MICRO = 300_000L;
    public static final long WAIT_MS = 60_000L;
    private final JdbcTemplate jdbc;
    private final MigrationAccounts accounts;
    private final JsonMapper json;
    private final TransactionTemplate transaction;
    private final String schema;
    private final boolean enabledFlag;
    private final long budgetMicro;
    private final int maximum;
    private final Set<String> allowedUsers;
    private final Set<String> unlimitedUsers;
    private final String key;
    private final FixtureTokenTransport transport;

    public PromptService(JdbcTemplate jdbc, MigrationAccounts accounts, PlatformTransactionManager manager,
                         Environment env, JsonMapper json) {
        this.jdbc = jdbc; this.accounts = accounts; this.json = json;
        this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M16 prompt");
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(10);
        enabledFlag = Boolean.parseBoolean(env.getProperty("migration.prompt-enabled", "false"));
        double budget, max;
        try {
            budget = Double.parseDouble(env.getProperty("migration.prompt-budget-usd", "0"));
            max = Double.parseDouble(env.getProperty("migration.prompt-max-sessions", "0"));
        } catch (NumberFormatException error) {
            budget = max = 0;
        }
        budgetMicro = Double.isFinite(budget) ? Math.round(budget * 1_000_000) : 0;
        maximum = Double.isFinite(max) && max == Math.floor(max) && max > 0 && max <= 20 ? (int) max : 0;
        allowedUsers = names(env.getProperty("migration.prompt-allowed-usernames", ""));
        unlimitedUsers = names(env.getProperty("migration.prompt-unlimited-usernames", ""));
        if (RuntimePolicy.runtime(env) && (allowedUsers.isEmpty() || !allowedUsers.containsAll(unlimitedUsers)))
            throw new IllegalStateException("Runtime prompt whitelist must include all unlimited users");
        key = env.getProperty("migration.prompt-key", "").strip();
        String endpoint = env.getRequiredProperty("migration.prompt-token-url");
        transport = new FixtureTokenTransport(URI.create(endpoint), key, json, Duration.ofSeconds(10), RuntimePolicy.runtime(env));
    }

    private static Set<String> names(String value) {
        return new LinkedHashSet<>(Arrays.stream(value.split(",")).map(String::strip).filter(item -> !item.isEmpty()).toList());
    }

    public boolean configured() {
        boolean bounded = budgetMicro >= RISK_MICRO && budgetMicro <= 5_000_000 && maximum > 0;
        return enabledFlag && !key.isEmpty() && (bounded || !unlimitedUsers.isEmpty());
    }

    public Map<String, Object> status(String userId) {
        Map<String, Object> value = transaction.execute(status -> ready(userId));
        if (Boolean.TRUE.equals(value.get("available")) && userId != null) value.put("access", nonce());
        return value;
    }

    public void authenticate(String supplied) {
        if (!configured() || paused()) {
            throw new BusinessFailure("PROMPT_DISABLED", "实时编辑尚未开放。", 503);
        }
        String expected = nonce();
        if (supplied == null || !supplied.matches("[a-f0-9]{64}")
                || !MessageDigest.isEqual(supplied.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                expected.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            throw new BusinessFailure("PROMPT_UNAUTHORIZED", "编辑访问凭据无效，请刷新页面。", 401);
        }
    }

    public Map<String, Object> issue(String hashed, JsonNode body, String origin) {
        Set<String> fields = new java.util.LinkedHashSet<>();
        body.propertyNames().forEach(fields::add);
        JsonNode ident = body.get("attemptId"), consent = body.get("consentVersion"), duration = body.get("durationSec");
        if (!fields.equals(Set.of("attemptId", "consentVersion", "durationSec")) || ident == null || !ident.isString()
                || !MigrationSupport.isUuid(ident.asString()) || consent == null || !consent.isString()
                || !CONSENT.equals(consent.asString()) || duration == null || !duration.isIntegralNumber()
                || duration.asInt() != 15) {
            throw new BusinessFailure("INVALID_PROMPT_SESSION", "连接参数或云端确认无效。", 400);
        }
        String attemptId = ident.asString();
        reserve(hashed, attemptId);
        String failure = "request";
        try {
            JsonNode token = transport.issue(MODEL, origin, 15);
            failure = "validation";
            ClientTokenValidator.validate(token, MODEL, origin, 15, key, System.currentTimeMillis());
            failure = "persistence";
            transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                    + "usage_attempts SET state='issued',updated_at=? WHERE id=? AND scene='prompt'",
                    System.currentTimeMillis(), attemptId));
            return MigrationSupport.body("apiKey", token.get("apiKey").asString(),
                    "expiresAt", token.get("expiresAt").asString(), "durationSec", 15);
        } catch (RuntimeException error) {
            String code = error instanceof ClientTokenValidator.InvalidToken invalid ? invalid.code
                    : failure.equals("request") ? "UPSTREAM_CONNECTION" : failure.equals("validation")
                    ? "INVALID_TOKEN_RESPONSE" : "PERSISTENCE_FAILED";
            try {
                transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                                + "usage_attempts SET observation=?,updated_at=? WHERE id=? AND scene='prompt' AND state='unknown' AND observation IS NULL",
                        json.writeValueAsString(Map.of("tokenFailure", code)), System.currentTimeMillis(), attemptId));
            } catch (RuntimeException ignored) {
                // 诊断写入失败不改变unknown与预算保留。
            }
            throw new BusinessFailure("PROMPT_TOKEN_UNKNOWN", "短期令牌未能确认（" + code
                    + "），本轮未取得可用连接凭据，已停止。不会自动重试，可用状态以页面为准。", 503);
        }
    }

    private void reserve(String hashed, String attemptId) {
        transaction.executeWithoutResult(status -> {
            if (paused()) throw new BusinessFailure("SERVICE_PAUSED", "该功能已暂停新生成，请稍后再试。", 503);
            MigrationAccounts.User user = accounts.require(hashed);
            if (!jdbc.queryForList("SELECT id FROM " + schema + "usage_attempts WHERE id=?", attemptId).isEmpty()) {
                throw new BusinessFailure("PROMPT_ATTEMPT_SPENT", "这个连接已申请，请核查状态，不要重复提交。", 409);
            }
            Map<String, Object> ready = ready(user.id());
            if (!Boolean.TRUE.equals(ready.get("available"))) {
                throw new BusinessFailure("PROMPT_LIMIT", String.valueOf(ready.get("message")), 409);
            }
            jdbc.update("INSERT INTO " + schema + "budget_campaigns(scene,created_at) VALUES ('prompt',?) ON CONFLICT (scene) DO NOTHING",
                    System.currentTimeMillis());
            jdbc.queryForList("SELECT scene FROM " + schema + "budget_campaigns WHERE scene='prompt' FOR UPDATE");
            long now = System.currentTimeMillis();
            jdbc.update("INSERT INTO " + schema + "usage_attempts(id,user_id,scene,seconds,state,created_at) "
                    + "VALUES (?,?,'prompt',15,'unknown',?)", attemptId, user.id(), now);
            jdbc.update("INSERT INTO " + schema + "budget_reservations(id,scene,user_id,micro_usd,lease_until,created_at) "
                    + "VALUES (?,'prompt',?,?,?,?)", attemptId, user.id(), RISK_MICRO, now + 45_000, now);
        });
    }

    private Map<String, Object> ready(String userId) {
        boolean enabled = configured() && !paused();
        boolean allowed = userId == null ? allowedUsers.isEmpty() : allowed(userId);
        if (!enabled) return MigrationSupport.body("available", false, "message", "实时编辑待开放，可先准备提示词与相机预览。");
        if (!allowed) return MigrationSupport.body("available", false, "message", "实时编辑目前仅向指定测试账号开放。");
        if (userId != null && unlimitedUsers.contains(username(userId))) {
            return MigrationSupport.body("available", true, "message", "实时编辑已就绪，可手动开始。");
        }
        List<Map<String, Object>> attempts = jdbc.queryForList("SELECT * FROM " + schema
                + "usage_attempts WHERE scene='prompt' ORDER BY created_at,id");
        List<Map<String, Object>> reservations = jdbc.queryForList("SELECT * FROM " + schema
                + "budget_reservations WHERE scene='prompt' ORDER BY created_at,id");
        long now = System.currentTimeMillis();
        for (var attempt : attempts) {
            if (!"unknown".equals(attempt.get("state"))) continue;
            var risk = reservations.stream().filter(row -> attempt.get("id").equals(row.get("id"))).findFirst().orElse(null);
            if (risk == null || MigrationSupport.number(risk, "micro_usd") < RISK_MICRO) {
                return MigrationSupport.body("available", false, "message", "上次申请的预算预留无法核对，请联系维护者处理。");
            }
            long wait = Math.max(MigrationSupport.number(attempt, "created_at") + WAIT_MS,
                    Math.max(MigrationSupport.number(attempt, "updated_at") == 0 ? MigrationSupport.number(attempt, "created_at")
                            : MigrationSupport.number(attempt, "updated_at"), MigrationSupport.number(risk, "lease_until")));
            if (now < wait) {
                return MigrationSupport.body("available", false, "message",
                        "上次令牌申请未确认，已保留预算占用；请等待约" + ((wait - now + 999) / 1000) + "秒后再手动开始，不会自动重试。");
            }
        }
        if (reservations.stream().anyMatch(row -> MigrationSupport.number(row, "lease_until") > now)) {
            return MigrationSupport.body("available", false, "message", "连接窗口尚未结束，请稍后刷新状态。");
        }
        long reserved = reservations.stream().mapToLong(row -> MigrationSupport.number(row, "micro_usd")).sum();
        if (attempts.size() >= maximum || reserved + RISK_MICRO > budgetMicro) {
            return MigrationSupport.body("available", false, "message", "本轮实时编辑额度已用完。");
        }
        return MigrationSupport.body("available", true, "message", attempts.isEmpty()
                ? "实时编辑已就绪，每次最多15秒。" : "上次未确认申请仍保留次数和预算占用，等待窗口已结束；可手动开始新一轮。");
    }

    private boolean allowed(String userId) {
        if (allowedUsers.isEmpty()) return true;
        String name = username(userId);
        return name != null && allowedUsers.contains(name);
    }

    private String username(String userId) {
        var user = accounts.byId(userId);
        return user == null ? null : user.username();
    }

    private boolean paused() {
        var rows = jdbc.queryForList("SELECT value FROM " + schema + "admin_settings WHERE key='services'");
        if (rows.isEmpty()) return false;
        JsonNode settings = json.readTree((String) rows.getFirst().get("value"));
        JsonNode prompt = settings.get("prompt");
        return prompt != null && prompt.isBoolean() && prompt.asBoolean();
    }

    private String nonce() {
        return transaction.execute(status -> {
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            jdbc.update("INSERT INTO " + schema + "scene_access(scene,value) VALUES ('prompt',?) ON CONFLICT (scene) DO NOTHING",
                    HexFormat.of().formatHex(bytes));
            return jdbc.queryForObject("SELECT value FROM " + schema + "scene_access WHERE scene='prompt'", String.class);
        });
    }
}
