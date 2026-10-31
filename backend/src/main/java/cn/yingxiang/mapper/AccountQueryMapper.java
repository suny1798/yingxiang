package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/** 账号视图只读查询；保留 REPEATABLE READ 事务由 AccountReader 控制。 */
@Mapper
public interface AccountQueryMapper {

    @Select("SELECT EXISTS(SELECT 1 FROM ${schema}video_jobs WHERE user_id=#{userId} AND created_at>=#{since})")
    boolean videoTrialUsed(@Param("schema") String schema, @Param("userId") String userId, @Param("since") long since);

    @Select("SELECT count(*) FROM ${schema}flyway_schema_history WHERE version='1' AND success")
    Integer flywayV1(@Param("schema") String schema);

    @Select("SELECT count(*) FROM information_schema.tables WHERE table_schema=#{schemaName} "
            + "AND table_name IN ('users','auth_sessions','entitlement_grants','usage_attempts','flyway_schema_history')")
    Integer readableTables(@Param("schemaName") String schemaName);

    @Select("SELECT u.id,u.username,u.created_at,u.role FROM ${schema}users u "
            + "JOIN ${schema}auth_sessions s ON s.user_id=u.id "
            + "WHERE s.hash=#{hash} AND s.expires_at>#{now} AND u.disabled=0")
    Map<String, Object> sessionUser(@Param("schema") String schema, @Param("hash") String hash, @Param("now") long now);

    @Select("SELECT seconds,sum(total-revoked) AS quota,sum(total-reserved-used-revoked) AS remaining "
            + "FROM ${schema}entitlement_grants WHERE user_id=#{userId} AND environment='real_usage' GROUP BY seconds")
    List<Map<String, Object>> balances(@Param("schema") String schema, @Param("userId") String userId);

    @Select("SELECT h.id,h.kind,h.created_at,h.seconds,h.status,j.result_duration_ms,"
            + "EXISTS(SELECT 1 FROM ${schema}works w WHERE w.source_id=h.id AND w.kind='video' AND w.state IN ('waiting','saving')) AS result_pending,"
            + "c.state AS billing_state,c.reserved_credits,c.charged_credits FROM ("
            + "SELECT id,'realtime' AS kind,created_at,seconds,"
            + "CASE WHEN account_state='review' THEN 'review' WHEN outcome='ended' THEN 'ended' "
            + "WHEN outcome='error' THEN 'error' ELSE 'issued' END AS status "
            + "FROM ${schema}usage_attempts WHERE user_id=#{userId} AND scene='studio' AND account_state IS NOT NULL "
            + "UNION ALL "
            + "SELECT id,'edit' AS kind,created_at,seconds,"
            + "CASE WHEN state='unknown' THEN 'review' WHEN state='issued' THEN 'issued' ELSE 'ended' END AS status "
            + "FROM ${schema}usage_attempts WHERE user_id=#{userId} AND scene='prompt' "
            + "UNION ALL "
            + "SELECT id,'video' AS kind,created_at,ROUND(seconds_milli/1000.0,3) AS seconds,"
            + "CASE state WHEN 'unknown' THEN 'review' WHEN 'pending' THEN 'processing' "
            + "WHEN 'processing' THEN 'processing' WHEN 'completed' THEN 'completed' "
            + "WHEN 'failed' THEN 'error' ELSE 'issued' END AS status "
            + "FROM ${schema}video_jobs WHERE user_id=#{userId}"
            + ") h LEFT JOIN ${schema}video_jobs j ON h.kind='video' AND j.id=h.id AND j.user_id=#{userId} "
            + "LEFT JOIN ${schema}billing_credit_charges c ON c.id=h.id AND c.user_id=#{userId} AND c.environment='real_usage' "
            + "ORDER BY h.created_at DESC,h.id DESC LIMIT 20")
    List<Map<String, Object>> history(@Param("schema") String schema, @Param("userId") String userId);

    @Select("SELECT EXISTS(SELECT 1 FROM ${schema}usage_attempts "
            + "WHERE user_id=#{userId} AND scene='studio' AND seconds=15 AND account_state='review')")
    boolean review(@Param("schema") String schema, @Param("userId") String userId);
}
