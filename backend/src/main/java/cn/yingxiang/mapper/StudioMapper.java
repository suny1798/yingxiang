package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Map;

/** Studio 替身观测与场景访问 SQL。 */
@Mapper
public interface StudioMapper {

    @Select("SELECT state,observation FROM ${schema}usage_attempts WHERE id=#{ident} AND user_id=#{userId} "
            + "AND scene='studio' FOR UPDATE")
    Map<String, Object> lockAttempt(@Param("schema") String schema, @Param("ident") String ident,
                                    @Param("userId") String userId);

    @Update("UPDATE ${schema}usage_attempts SET observation=#{observation},outcome=#{outcome},state=#{state},"
            + "updated_at=#{now} WHERE id=#{ident}")
    int observe(@Param("schema") String schema, @Param("ident") String ident, @Param("observation") String observation,
                @Param("outcome") String outcome, @Param("state") String state, @Param("now") long now);

    @Select("SELECT value FROM ${schema}admin_settings WHERE key='services'")
    String servicesSetting(@Param("schema") String schema);

    @Insert("INSERT INTO ${schema}scene_access(scene,value) VALUES ('studio',#{value}) ON CONFLICT (scene) DO NOTHING")
    int ensureSceneAccess(@Param("schema") String schema, @Param("value") String value);

    @Select("SELECT value FROM ${schema}scene_access WHERE scene='studio'")
    String sceneAccess(@Param("schema") String schema);
}
