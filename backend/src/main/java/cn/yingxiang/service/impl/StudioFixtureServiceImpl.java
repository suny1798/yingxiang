package cn.yingxiang.service.impl;

import cn.yingxiang.service.StudioFixtureService;
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
import cn.yingxiang.service.EntitlementReservationService;

@Service
@Profile("local")
@org.springframework.boot.autoconfigure.condition.ConditionalOnExpression("${migration.studio-fixture-enabled:false} or (${migration.runtime-enabled:false} and ${migration.studio-enabled:false})")
public class StudioFixtureServiceImpl implements StudioFixtureService {

    private final JdbcTemplate jdbc;

    private final TransactionTemplate transaction;

    private final EntitlementReservationService reservations;

    private final AccountReader accounts;

    private final JsonMapper json;

    private final FixtureTokenTransport transport;

    private final JsonNode policy;

    private final String schema;

    private final String key;

    public StudioFixtureServiceImpl(JdbcTemplate jdbc, PlatformTransactionManager manager, Environment env,
                                    EntitlementReservationService reservations, AccountReader accounts, JsonMapper json) throws java.io.IOException {
            this.jdbc = jdbc; this.reservations = reservations; this.accounts = accounts; this.json = json;
            schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "studio");
            key = RuntimePolicy.runtime(env) ? env.getRequiredProperty("migration.studio-key") : "synthetic-studio-permanent-key";
            transaction = new TransactionTemplate(manager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.setTimeout(10);
            try (var stream = getClass().getResourceAsStream("/studio-policy.json")) { policy = json.readTree(stream); }
            transport = new FixtureTokenTransport(URI.create(env.getRequiredProperty(RuntimePolicy.runtime(env) ? "migration.studio-token-url" : "migration.studio-fixture-url")), key, json, Duration.ofSeconds(10), RuntimePolicy.runtime(env));
        }

    @PreDestroy public void close() { transport.close(); }

    public Map<String, Object> status() {
            boolean enabled = !paused();
            var result = new LinkedHashMap<String, Object>();
            result.put("enabled", enabled); result.put("keyConfigured", true); result.put("available", enabled);
            result.put("policy", policy); result.put("state", enabled ? "ready" : "disabled");
            if (enabled) result.put("access", nonce());
            return result;
        }

    public String require(String hash) {
            Object value = accounts.read(hash).get("user");
            if (!(value instanceof Map<?, ?> user)) throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
            return (String) user.get("id");
        }

    public void authenticate(String access) {
            if (paused()) throw new BusinessFailure("SERVICE_DISABLED", "请先在服务端配置密钥并启用本机验证。", 503);
            String expected = nonce();
            if (access == null || !access.matches("[a-f0-9]{64}") || !MessageDigest.isEqual(access.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8)))
                throw new BusinessFailure("UNAUTHORIZED", "本地验证凭据无效，请刷新验证页面。", 401);
        }

    public Map<String, Object> issue(String hashed, JsonNode body, String origin) {
            Set<String> fields = new HashSet<>(); body.propertyNames().forEach(fields::add);
            JsonNode consent = body.get("consentVersion"), id = body.get("attemptId");
            if (!(fields.equals(Set.of("attemptId", "consentVersion", "durationSec")) || fields.equals(Set.of("attemptId", "consentVersion")))
                    || id == null || !id.isString() || consent == null || !consent.equals(policy.get("consentVersion")))
                throw invalid();
            // ID格式先于档位检查，与旧入口错误顺序一致。
            EntitlementReservationService.validate(id.asString(), 15);
            JsonNode duration = body.get("durationSec");
            int seconds = 15;
            if (duration != null) {
                if (!duration.isNumber() || !Double.isFinite(duration.asDouble()) || !List.of(15.0, 30.0, 60.0).contains(duration.asDouble()))
                    throw new BusinessFailure("INVALID_DURATION", "请选择15秒、30秒或1分钟。", 400);
                seconds = duration.asInt();
            }
            reservations.reserve(hashed, id.asString(), seconds); // 独立事务先提交unknown。
            try {
                JsonNode token = transport.issue(policy.get("model").asString(), origin, seconds);
                ClientTokenValidator.validate(token, policy.get("model").asString(), origin, seconds, key, System.currentTimeMillis());
                reservations.confirmIssued(id.asString());
                return Map.of("apiKey", token.get("apiKey").asString(), "expiresAt", token.get("expiresAt").asString(), "durationSec", seconds);
            } catch (RuntimeException error) {
                throw new BusinessFailure("TOKEN_RESULT_UNKNOWN", "令牌未能安全取得。请检查模型权限、余额和网络并核对用量；本轮不自动重试。", 503);
            }
        }

    public void observe(String userId, JsonNode body) {
            Set<String> fields = new HashSet<>(); body.propertyNames().forEach(fields::add);
            JsonNode id = body.get("attemptId"), outcome = body.get("outcome"), ended = body.get("localTracksEnded");
            if (!fields.equals(Set.of("attemptId", "firstFrameMs", "localTracksEnded", "outcome", "providerReportedSeconds"))
                    || id == null || !id.isString() || !id.asString().matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
                    || outcome == null || !outcome.isString() || !Set.of("ended", "error").contains(outcome.asString()) || ended == null || !ended.isBoolean())
                throw new BusinessFailure("INVALID_REQUEST", "观测记录无效。", 400);
            for (String field : List.of("firstFrameMs", "providerReportedSeconds")) {
                JsonNode value = body.get(field);
                if (!value.isNull() && (!value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() < 0 || value.asDouble() > 120_000))
                    throw new BusinessFailure("INVALID_REQUEST", "观测数值无效。", 400);
            }
            transaction.executeWithoutResult(status -> {
                var rows = jdbc.queryForList("SELECT state,observation FROM " + schema + "usage_attempts WHERE id=? AND user_id=? AND scene='studio' FOR UPDATE", id.asString(), userId);
                if (rows.isEmpty() || "reserved".equals(rows.getFirst().get("state"))) throw new BusinessFailure("ATTEMPT_NOT_FOUND", "没有可归属的测试记录。", 409);
                if (rows.getFirst().get("observation") instanceof String value && !value.isEmpty()) return;
                var observation = json.createObjectNode();
                for (String field : List.of("firstFrameMs", "localTracksEnded", "outcome", "providerReportedSeconds")) observation.set(field, body.get(field));
                jdbc.update("UPDATE " + schema + "usage_attempts SET observation=?,outcome=?,state=?,updated_at=? WHERE id=?", json.writeValueAsString(observation), outcome.asString(),
                        "issued".equals(rows.getFirst().get("state")) ? "finished" : rows.getFirst().get("state"), System.currentTimeMillis(), id.asString());
            });
        }

    private boolean paused() {
            var rows = jdbc.queryForList("SELECT value FROM " + schema + "admin_settings WHERE key='services'");
            if (rows.isEmpty()) return false;
            JsonNode settings = json.readTree((String) rows.getFirst().get("value"));
            if (!settings.isObject()) throw BusinessFailure.unavailable();
            JsonNode studio = settings.get("studio");
            return studio != null && studio.isBoolean() && studio.asBoolean();
        }

    private String nonce() {
            return transaction.execute(status -> {
                byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
                jdbc.update("INSERT INTO " + schema + "scene_access(scene,value) VALUES ('studio',?) ON CONFLICT (scene) DO NOTHING", HexFormat.of().formatHex(bytes));
                return jdbc.queryForObject("SELECT value FROM " + schema + "scene_access WHERE scene='studio'", String.class);
            });
        }

    private static BusinessFailure invalid() { return new BusinessFailure("INVALID_REQUEST", "体验编号或云端处理确认无效，请重新确认。", 400); }
}
