package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/** 账号视图只读查询；保留 REPEATABLE READ 事务由 AccountReader 控制。 */
@Mapper
public interface AccountQueryMapper {

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

    @Select("SELECT id,created_at,seconds,account_state,outcome FROM ${schema}usage_attempts "
            + "WHERE user_id=#{userId} AND scene='studio' AND account_state IS NOT NULL "
            + "ORDER BY created_at DESC,id DESC LIMIT 20")
    List<Map<String, Object>> studioHistory(@Param("schema") String schema, @Param("userId") String userId);

    @Select("SELECT EXISTS(SELECT 1 FROM ${schema}usage_attempts "
            + "WHERE user_id=#{userId} AND scene='studio' AND seconds=15 AND account_state='review')")
    boolean review(@Param("schema") String schema, @Param("userId") String userId);
}
