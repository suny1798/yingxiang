package cn.yingxiang.bootstrap;

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

/** 内部事务服务，不发上游请求、不暴露确认入口、不自动释放unknown。 */
@Service
@Profile("local")
public class EntitlementReservationService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final String schema;

    public EntitlementReservationService(JdbcTemplate jdbc, PlatformTransactionManager manager, Environment env) {
        this.jdbc = jdbc;
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
                var users = jdbc.queryForList("SELECT u.id,s.expires_at FROM " + schema + "users u JOIN " + schema
                        + "auth_sessions s ON s.user_id=u.id WHERE s.hash=? AND u.disabled=0 FOR UPDATE OF u,s", hashed == null ? "" : hashed);
                // 等待行锁期间会话可能到期；取得锁后再按当前时间判断。
                if (users.isEmpty() || ((Number) users.getFirst().get("expires_at")).longValue() <= System.currentTimeMillis()) {
                    throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
                }
                String userId = (String) users.getFirst().get("id");
                if (!jdbc.queryForList("SELECT id FROM " + schema + "usage_attempts WHERE id=?", attemptId).isEmpty()) throw spent();
                var grants = jdbc.queryForList("SELECT id FROM " + schema + "entitlement_grants WHERE user_id=? AND seconds=? "
                        + "AND environment='real_usage' AND total>reserved+used+revoked ORDER BY id LIMIT 1 FOR UPDATE", userId, seconds);
                if (grants.isEmpty()) throw unavailableDuration(seconds);
                String grantId = (String) grants.getFirst().get("id");
                int changed = jdbc.update("UPDATE " + schema + "entitlement_grants SET reserved=reserved+1 WHERE id=? "
                        + "AND user_id=? AND environment='real_usage' AND total>reserved+used+revoked", grantId, userId);
                if (changed != 1) throw unavailableDuration(seconds);
                long now = System.currentTimeMillis();
                jdbc.update("INSERT INTO " + schema + "entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) VALUES (?,?,?,'reserve',1,?)",
                        UUID.randomUUID().toString(), grantId, "reserve:" + attemptId, now);
                jdbc.update("INSERT INTO " + schema + "usage_attempts(id,user_id,grant_id,scene,seconds,state,account_state,created_at) "
                        + "VALUES (?,?,?,'studio',?,'unknown','review',?)", attemptId, userId, grantId, seconds, now);
            });
        } catch (DataIntegrityViolationException error) {
            // 同attempt跨账号并发由主键／唯一operation_key兜底，整个预留回滚。
            throw spent();
        }
    }

    /** 仅由可信签发适配器在严格验证上游成功后调用；浏览器不能直接触发。 */
    public boolean confirmIssued(String attemptId) {
        validateId(attemptId);
        return Boolean.TRUE.equals(transaction.execute(status -> {
            var rows = jdbc.queryForList("SELECT grant_id,user_id,account_state FROM " + schema
                    + "usage_attempts WHERE id=? AND scene='studio' FOR UPDATE", attemptId);
            if (rows.isEmpty() || rows.getFirst().get("grant_id") == null) throw BusinessFailure.unavailable();
            var attempt = rows.getFirst();
            if ("used".equals(attempt.get("account_state"))) return false;
            int changed = jdbc.update("UPDATE " + schema + "entitlement_grants SET reserved=reserved-1,used=used+1 "
                            + "WHERE id=? AND user_id=? AND environment='real_usage' AND reserved>0",
                    attempt.get("grant_id"), attempt.get("user_id"));
            if (changed != 1) throw BusinessFailure.unavailable();
            long now = System.currentTimeMillis();
            jdbc.update("INSERT INTO " + schema + "entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) VALUES (?,?,?,'consume',1,?)",
                    UUID.randomUUID().toString(), attempt.get("grant_id"), "consume:" + attemptId, now);
            jdbc.update("UPDATE " + schema + "usage_attempts SET state='issued',account_state='used',updated_at=? WHERE id=?", now, attemptId);
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
