package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 权益预留／确认 SQL；保留 FOR UPDATE 与条件扣减。 */
@Mapper
public interface EntitlementMapper {

    @Select("SELECT EXISTS(SELECT 1 FROM ${schema}admin_settings WHERE key='services' "
            + "AND (value::jsonb -> 'studio')='true'::jsonb)")
    boolean paused(@Param("schema") String schema);

    @Select("SELECT u.id,s.expires_at FROM ${schema}users u JOIN ${schema}auth_sessions s ON s.user_id=u.id "
            + "WHERE s.hash=#{hash} AND u.disabled=0 FOR UPDATE OF u,s")
    List<Map<String, Object>> lockSession(@Param("schema") String schema, @Param("hash") String hash);

    @Select("SELECT id FROM ${schema}usage_attempts WHERE id=#{ident}")
    List<String> attemptIds(@Param("schema") String schema, @Param("ident") String ident);

    @Select("SELECT id FROM ${schema}entitlement_grants WHERE user_id=#{userId} AND seconds=#{seconds} "
            + "AND environment='real_usage' AND total>reserved+used+revoked ORDER BY id LIMIT 1 FOR UPDATE")
    List<String> availableGrant(@Param("schema") String schema, @Param("userId") String userId,
                                @Param("seconds") int seconds);

    @Update("UPDATE ${schema}entitlement_grants SET reserved=reserved+1 WHERE id=#{grantId} "
            + "AND user_id=#{userId} AND environment='real_usage' AND total>reserved+used+revoked")
    int reserveGrant(@Param("schema") String schema, @Param("grantId") String grantId,
                     @Param("userId") String userId);

    @Insert("INSERT INTO ${schema}entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
            + "VALUES (#{id},#{grantId},#{operationKey},#{kind},#{quantity},#{now})")
    int insertEntry(@Param("schema") String schema, @Param("id") String id, @Param("grantId") String grantId,
                    @Param("operationKey") String operationKey, @Param("kind") String kind,
                    @Param("quantity") int quantity, @Param("now") long now);

    @Insert("INSERT INTO ${schema}usage_attempts(id,user_id,grant_id,scene,seconds,state,account_state,created_at) "
            + "VALUES (#{ident},#{userId},#{grantId},'studio',#{seconds},'unknown','review',#{now})")
    int insertAttempt(@Param("schema") String schema, @Param("ident") String ident, @Param("userId") String userId,
                      @Param("grantId") String grantId, @Param("seconds") int seconds, @Param("now") long now);

    @Select("SELECT grant_id,user_id,account_state FROM ${schema}usage_attempts "
            + "WHERE id=#{ident} AND scene='studio' FOR UPDATE")
    Map<String, Object> lockAttempt(@Param("schema") String schema, @Param("ident") String ident);

    @Update("UPDATE ${schema}entitlement_grants SET reserved=reserved-1,used=used+1 "
            + "WHERE id=#{grantId} AND user_id=#{userId} AND environment='real_usage' AND reserved>0")
    int consumeGrant(@Param("schema") String schema, @Param("grantId") String grantId,
                     @Param("userId") String userId);

    @Update("UPDATE ${schema}usage_attempts SET state='issued',account_state='used',updated_at=#{now} WHERE id=#{ident}")
    int markIssued(@Param("schema") String schema, @Param("ident") String ident, @Param("now") long now);
}
