package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;

/** 注册、登录会话 SQL；scrypt 计算仍在事务外。 */
@Mapper
public interface AccountAuthMapper {

    @Select("SELECT id,salt,password_hash FROM ${schema}users WHERE username=#{name}")
    Map<String, Object> findByUsername(@Param("schema") String schema, @Param("name") String name);

    @Insert("INSERT INTO ${schema}users(id,username,salt,password_hash,created_at) "
            + "VALUES (#{id},#{name},#{salt},#{encoded},#{now})")
    int insertUser(@Param("schema") String schema, @Param("id") String id, @Param("name") String name,
                   @Param("salt") String salt, @Param("encoded") String encoded, @Param("now") long now);

    @Insert("INSERT INTO ${schema}entitlement_grants(id,user_id,seconds,environment,source,source_key,total) "
            + "VALUES (#{id},#{userId},15,'real_usage','free',#{sourceKey},1)")
    int insertFreeGrant(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                        @Param("sourceKey") String sourceKey);

    @Insert("INSERT INTO ${schema}entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
            + "VALUES (#{id},#{grantId},#{operationKey},'grant',1,#{now})")
    int insertGrantEntry(@Param("schema") String schema, @Param("id") String id, @Param("grantId") String grantId,
                         @Param("operationKey") String operationKey, @Param("now") long now);

    @Select("SELECT disabled,password_hash FROM ${schema}users WHERE id=#{id} FOR UPDATE")
    Map<String, Object> lockUser(@Param("schema") String schema, @Param("id") String id);

    @Insert("INSERT INTO ${schema}auth_sessions(hash,user_id,expires_at) VALUES (#{hash},#{userId},#{expiresAt})")
    int insertSession(@Param("schema") String schema, @Param("hash") String hash, @Param("userId") String userId,
                      @Param("expiresAt") long expiresAt);

    @Delete("DELETE FROM ${schema}auth_sessions WHERE hash=#{hash}")
    int deleteSession(@Param("schema") String schema, @Param("hash") String hash);
}
