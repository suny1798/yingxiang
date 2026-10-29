package cn.yingxiang.mapper;

import cn.yingxiang.model.entity.User;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;

/**
 * 账号与会话相关 SQL。
 *
 * <p>schema 由调用方通过 {@code MigrationSupport.quotedSchema} 提供并校验，
 * 这里保留原显式 SQL 的原子语义（RETURNING、ON CONFLICT），不用通用 CRUD 改写。</p>
 */
@Mapper
public interface UserMapper extends BaseMapper<User> {

    @Select("SELECT u.id,u.username,u.role,u.created_at FROM ${schema}users u "
            + "JOIN ${schema}auth_sessions s ON s.user_id=u.id "
            + "WHERE s.hash=#{hash} AND s.expires_at>#{now} AND u.disabled=0")
    Map<String, Object> optional(@Param("schema") String schema, @Param("hash") String hash, @Param("now") long now);

    @Select("SELECT id,username,role,created_at FROM ${schema}users WHERE id=#{id}")
    Map<String, Object> byId(@Param("schema") String schema, @Param("id") String id);

    @Select("INSERT INTO ${schema}auth_rate_limits AS r(key,count,until) VALUES (#{key},1,#{until}) "
            + "ON CONFLICT(key) DO UPDATE SET count=CASE WHEN r.until<=#{now} THEN 1 ELSE r.count+1 END, "
            + "until=CASE WHEN r.until<=#{now} THEN #{until} ELSE r.until END RETURNING count")
    Integer rateLimit(@Param("schema") String schema, @Param("key") String key,
                      @Param("now") long now, @Param("until") long until);

    @Insert("INSERT INTO ${schema}entitlement_grants(id,user_id,seconds,environment,source,source_key,total) "
            + "VALUES (#{id},#{userId},#{seconds},#{environment},#{source},#{sourceKey},#{total})")
    int insertGrant(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                    @Param("seconds") int seconds, @Param("environment") String environment,
                    @Param("source") String source, @Param("sourceKey") String sourceKey, @Param("total") int total);

    @Insert("INSERT INTO ${schema}entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
            + "VALUES (#{id},#{grantId},#{operationKey},'grant',#{quantity},#{createdAt})")
    int insertGrantEntry(@Param("schema") String schema, @Param("id") String id, @Param("grantId") String grantId,
                         @Param("operationKey") String operationKey, @Param("quantity") int quantity,
                         @Param("createdAt") long createdAt);
}
