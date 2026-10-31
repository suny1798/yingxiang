package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 实时编辑会话、预算与场景访问 SQL。 */
@Mapper
public interface PromptMapper {

    @Update("UPDATE ${schema}usage_attempts SET state='issued',updated_at=#{now} WHERE id=#{ident} AND scene='prompt'")
    int markIssued(@Param("schema") String schema, @Param("ident") String ident, @Param("now") long now);

    @Update("UPDATE ${schema}usage_attempts SET observation=#{observation},updated_at=#{now} "
            + "WHERE id=#{ident} AND scene='prompt' AND state='unknown' AND observation IS NULL")
    int recordFailure(@Param("schema") String schema, @Param("ident") String ident,
                      @Param("observation") String observation, @Param("now") long now);

    @Select("SELECT id FROM ${schema}usage_attempts WHERE id=#{ident}")
    List<String> attemptIds(@Param("schema") String schema, @Param("ident") String ident);

    @Insert("INSERT INTO ${schema}budget_campaigns(scene,created_at) VALUES ('prompt',#{now}) ON CONFLICT (scene) DO NOTHING")
    int ensureCampaign(@Param("schema") String schema, @Param("now") long now);

    @Select("SELECT scene FROM ${schema}budget_campaigns WHERE scene='prompt' FOR UPDATE")
    List<String> lockCampaign(@Param("schema") String schema);

    @Insert("INSERT INTO ${schema}usage_attempts(id,user_id,scene,seconds,state,created_at) "
            + "VALUES (#{ident},#{userId},'prompt',#{seconds},'unknown',#{now})")
    int insertAttempt(@Param("schema") String schema, @Param("ident") String ident, @Param("userId") String userId,
                      @Param("now") long now, @Param("seconds") int seconds);

    @Insert("INSERT INTO ${schema}budget_reservations(id,scene,user_id,micro_usd,lease_until,created_at) "
            + "VALUES (#{ident},'prompt',#{userId},#{microUsd},#{leaseUntil},#{now})")
    int insertReservation(@Param("schema") String schema, @Param("ident") String ident, @Param("userId") String userId,
                          @Param("microUsd") long microUsd, @Param("leaseUntil") long leaseUntil, @Param("now") long now);

    @Select("SELECT * FROM ${schema}usage_attempts WHERE scene='prompt' ORDER BY created_at,id")
    List<Map<String, Object>> attempts(@Param("schema") String schema);

    @Select("SELECT * FROM ${schema}budget_reservations WHERE scene='prompt' ORDER BY created_at,id")
    List<Map<String, Object>> reservations(@Param("schema") String schema);

    @Select("SELECT value FROM ${schema}admin_settings WHERE key='services'")
    String servicesSetting(@Param("schema") String schema);

    @Insert("INSERT INTO ${schema}scene_access(scene,value) VALUES ('prompt',#{value}) ON CONFLICT (scene) DO NOTHING")
    int ensureSceneAccess(@Param("schema") String schema, @Param("value") String value);

    @Select("SELECT value FROM ${schema}scene_access WHERE scene='prompt'")
    String sceneAccess(@Param("schema") String schema);
}
