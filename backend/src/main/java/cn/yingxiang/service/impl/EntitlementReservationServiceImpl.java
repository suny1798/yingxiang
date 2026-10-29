package cn.yingxiang.service.impl;

import cn.yingxiang.service.EntitlementReservationService;
import cn.yingxiang.mapper.EntitlementMapper;
import cn.yingxiang.exception.BusinessFailure;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.util.UUID;

@Service
@Profile("local")
public class EntitlementReservationServiceImpl implements EntitlementReservationService {

    private final JdbcTemplate jdbc;

    private final EntitlementMapper entitlements;

    private final TransactionTemplate transaction;

    private final String schema;

    public EntitlementReservationServiceImpl(JdbcTemplate jdbc, EntitlementMapper entitlements,
                                             PlatformTransactionManager manager, Environment env) {
            this.jdbc = jdbc; this.entitlements = entitlements;
            String value = env.getRequiredProperty("migration.db-schema");
            if (!value.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException("Invalid quota schema");
            schema = '"' + value + '"' + ".";
            transaction = new TransactionTemplate(manager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            transaction.setReadOnly(false); transaction.setTimeout(10);
        }

    public void reserve(String hashed, String attemptId, int seconds) {
            validate(attemptId, seconds);
            try {
                transaction.executeWithoutResult(status -> {
                    if (entitlements.paused(schema)) throw new BusinessFailure("SERVICE_PAUSED", "该功能已暂停新生成，请稍后再试。", 503);
                    var users = entitlements.lockSession(schema, hashed == null ? "" : hashed);
                    // 等待行锁期间会话可能到期；取得锁后再按当前时间判断。
                    if (users.isEmpty() || ((Number) users.getFirst().get("expires_at")).longValue() <= System.currentTimeMillis()) {
                        throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
                    }
                    String userId = (String) users.getFirst().get("id");
                    if (!entitlements.attemptIds(schema, attemptId).isEmpty()) throw spent();
                    var grants = entitlements.availableGrant(schema, userId, seconds);
                    if (grants.isEmpty()) throw unavailableDuration(seconds);
                    String grantId = grants.getFirst();
                    int changed = entitlements.reserveGrant(schema, grantId, userId);
                    if (changed != 1) throw unavailableDuration(seconds);
                    long now = System.currentTimeMillis();
                    entitlements.insertEntry(schema, UUID.randomUUID().toString(), grantId, "reserve:" + attemptId,
                            "reserve", 1, now);
                    entitlements.insertAttempt(schema, attemptId, userId, grantId, seconds, now);
                });
            } catch (DataIntegrityViolationException error) {
                // 同attempt跨账号并发由主键／唯一operation_key兜底，整个预留回滚。
                for (Throwable cause = error; cause != null; cause = cause.getCause()) {
                    if (cause instanceof java.sql.SQLException sql && "23505".equals(sql.getSQLState())) throw spent();
                }
                throw BusinessFailure.unavailable();
            }
        }

    /** 仅由可信签发适配器在严格验证上游成功后调用；浏览器不能直接触发。 */
        public boolean confirmIssued(String attemptId) {
            validateId(attemptId);
            return Boolean.TRUE.equals(transaction.execute(status -> {
                var attempt = entitlements.lockAttempt(schema, attemptId);
                if (attempt == null || attempt.get("grant_id") == null) throw BusinessFailure.unavailable();
                if ("used".equals(attempt.get("account_state"))) return false;
                int changed = entitlements.consumeGrant(schema, (String) attempt.get("grant_id"),
                        (String) attempt.get("user_id"));
                if (changed != 1) throw BusinessFailure.unavailable();
                long now = System.currentTimeMillis();
                entitlements.insertEntry(schema, UUID.randomUUID().toString(), (String) attempt.get("grant_id"),
                        "consume:" + attemptId, "consume", 1, now);
                entitlements.markIssued(schema, attemptId, now);
                return true;
            }));
        }

    public static void validate(String id, int seconds) {
            validateId(id);
            if (!List.of(15, 30, 60).contains(seconds)) throw new BusinessFailure("INVALID_DURATION", "请选择15秒、30秒或1分钟。", 400);
        }

    private static void validateId(String id) {
            if (id == null || !id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
                throw new BusinessFailure("INVALID_REQUEST", "体验编号或云端处理确认无效，请重新确认。", 400);
            }
        }

    private static BusinessFailure spent() { return new BusinessFailure("ATTEMPT_SPENT", "这次连接已申请，不能重复发送。请结束当前体验后手动再次开启。", 409); }

    private static BusinessFailure unavailableDuration(int seconds) {
            return new BusinessFailure(seconds == 15 ? "TRIAL_USED" : "DURATION_UNAVAILABLE", seconds == 15
                    ? "免费体验已使用或正在处理中，付费功能尚未开放。" : "当前账号没有此时长权益，在线购买尚未开放。", 409);
        }
}
