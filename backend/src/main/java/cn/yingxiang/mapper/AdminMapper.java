package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 管理台固定 SQL；动态筛选与分页仍由 AdministrationServiceImpl 构造。 */
@Mapper
public interface AdminMapper {

    @Select("SELECT coalesce(sum(micro_usd),0) AS total FROM ${schema}budget_reservations WHERE scene=#{scene}")
    List<Map<String, Object>> budgetReserved(@Param("schema") String schema, @Param("scene") String scene);

    @Select("SELECT role,disabled FROM ${schema}users WHERE id=#{ident} FOR UPDATE")
    Map<String, Object> lockUser(@Param("schema") String schema, @Param("ident") String ident);

    @Update("UPDATE ${schema}users SET role=#{role},disabled=#{disabled} WHERE id=#{ident}")
    int updateUser(@Param("schema") String schema, @Param("ident") String ident,
                   @Param("role") String role, @Param("disabled") int disabled);

    @Delete("DELETE FROM ${schema}auth_sessions WHERE user_id=#{ident}")
    int deleteSessions(@Param("schema") String schema, @Param("ident") String ident);

    @Select("SELECT id,total,reserved,used,revoked FROM ${schema}entitlement_grants "
            + "WHERE user_id=#{userId} AND seconds=#{seconds} AND environment='real_usage' ORDER BY id FOR UPDATE")
    List<Map<String, Object>> lockGrants(@Param("schema") String schema, @Param("userId") String userId,
                                         @Param("seconds") int seconds);

    @Update("UPDATE ${schema}entitlement_grants SET revoked=revoked+#{quantity} WHERE id=#{grantId}")
    int revoke(@Param("schema") String schema, @Param("grantId") String grantId, @Param("quantity") int quantity);

    @Insert("INSERT INTO ${schema}entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
            + "VALUES (#{id},#{grantId},#{operationKey},'revoke',#{quantity},#{now})")
    int insertRevokeEntry(@Param("schema") String schema, @Param("id") String id, @Param("grantId") String grantId,
                          @Param("operationKey") String operationKey, @Param("quantity") int quantity,
                          @Param("now") long now);

    @Select("SELECT value,version FROM ${schema}admin_settings WHERE key=#{key}")
    Map<String, Object> setting(@Param("schema") String schema, @Param("key") String key);

    @Delete("DELETE FROM ${schema}admin_settings WHERE key=#{key}")
    int deleteSetting(@Param("schema") String schema, @Param("key") String key);

    @Insert("INSERT INTO ${schema}admin_settings(key,value,version) VALUES (#{key},#{value},#{version})")
    int insertSetting(@Param("schema") String schema, @Param("key") String key, @Param("value") String value,
                      @Param("version") int version);

    @Select("SELECT actor_id,action,target,changes FROM ${schema}admin_audit WHERE request_id=#{requestId}")
    Map<String, Object> auditByRequest(@Param("schema") String schema, @Param("requestId") String requestId);

    @Insert("INSERT INTO ${schema}admin_audit(id,request_id,actor_id,action,target,reason,changes,created_at) "
            + "VALUES (#{id},#{requestId},#{actorId},#{action},#{target},#{reason},#{changes},#{now})")
    int insertAudit(@Param("schema") String schema, @Param("id") String id, @Param("requestId") String requestId,
                    @Param("actorId") String actorId, @Param("action") String action, @Param("target") String target,
                    @Param("reason") String reason, @Param("changes") String changes, @Param("now") long now);

    @Select("SELECT seconds,sum(total-revoked) AS quota,sum(total-reserved-used-revoked) AS remaining "
            + "FROM ${schema}entitlement_grants WHERE user_id=#{userId} AND environment='real_usage' GROUP BY seconds")
    List<Map<String, Object>> balances(@Param("schema") String schema, @Param("userId") String userId);
}
