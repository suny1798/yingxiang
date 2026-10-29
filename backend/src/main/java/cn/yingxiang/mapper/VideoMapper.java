package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 视频任务、历史、预算预留 SQL；保留原事务与条件更新语义。 */
@Mapper
public interface VideoMapper {

    @Select("SELECT value FROM ${schema}admin_settings WHERE key='services'")
    String servicesSetting(@Param("schema") String schema);

    @Select("SELECT job_id FROM ${schema}video_history WHERE archived=1")
    List<String> archivedJobIds(@Param("schema") String schema);

    @Select("SELECT count(*) FROM ${schema}video_jobs j LEFT JOIN ${schema}video_history h ON h.job_id=j.id "
            + "WHERE j.user_id=#{userId} AND coalesce(h.archived,0)=#{archived}")
    int historyCount(@Param("schema") String schema, @Param("userId") String userId, @Param("archived") int archived);

    @Select("SELECT j.*,h.title,h.archived FROM ${schema}video_jobs j LEFT JOIN ${schema}video_history h "
            + "ON h.job_id=j.id WHERE j.user_id=#{userId} AND coalesce(h.archived,0)=#{archived} "
            + "ORDER BY j.created_at DESC,j.id DESC LIMIT #{size} OFFSET #{offset}")
    List<Map<String, Object>> history(@Param("schema") String schema, @Param("userId") String userId,
                                      @Param("archived") int archived, @Param("size") int size,
                                      @Param("offset") int offset);

    @Select("SELECT title,archived FROM ${schema}video_history WHERE job_id=#{ident}")
    Map<String, Object> historyEntry(@Param("schema") String schema, @Param("ident") String ident);

    @Insert("INSERT INTO ${schema}video_history(job_id,title,archived,updated_at) VALUES (#{ident},#{title},#{archived},#{now}) "
            + "ON CONFLICT (job_id) DO UPDATE SET title=excluded.title,archived=excluded.archived,"
            + "updated_at=excluded.updated_at")
    int upsertHistory(@Param("schema") String schema, @Param("ident") String ident, @Param("title") String title,
                      @Param("archived") int archived, @Param("now") long now);

    @Select("SELECT id,disabled FROM ${schema}users WHERE id=#{userId}")
    Map<String, Object> user(@Param("schema") String schema, @Param("userId") String userId);

    @Insert("INSERT INTO ${schema}budget_campaigns(scene,created_at) VALUES ('video',#{now}) "
            + "ON CONFLICT (scene) DO NOTHING")
    int ensureCampaign(@Param("schema") String schema, @Param("now") long now);

    @Select("SELECT scene FROM ${schema}budget_campaigns WHERE scene='video' FOR UPDATE")
    List<String> lockCampaign(@Param("schema") String schema);

    @Insert("INSERT INTO ${schema}video_jobs(id,user_id,state,created_at,expires_at,seconds_milli,micro_usd) "
            + "VALUES (#{id},#{userId},#{state},#{createdAt},#{expiresAt},#{secondsMilli},#{microUsd})")
    int insertJob(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                  @Param("state") String state, @Param("createdAt") long createdAt, @Param("expiresAt") long expiresAt,
                  @Param("secondsMilli") long secondsMilli, @Param("microUsd") long microUsd);

    @Insert("INSERT INTO ${schema}budget_reservations(id,scene,user_id,micro_usd,lease_until,created_at) "
            + "VALUES (#{id},'video',#{userId},#{microUsd},#{leaseUntil},#{createdAt})")
    int insertReservation(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                          @Param("microUsd") long microUsd, @Param("leaseUntil") long leaseUntil,
                          @Param("createdAt") long createdAt);

    @Update("UPDATE ${schema}video_jobs SET checked_at=#{now} WHERE id=#{ident}")
    int touchChecked(@Param("schema") String schema, @Param("ident") String ident, @Param("now") long now);

    @Update("UPDATE ${schema}video_jobs SET state=#{state} WHERE id=#{ident}")
    int updateState(@Param("schema") String schema, @Param("ident") String ident, @Param("state") String state);

    @Update("UPDATE ${schema}video_jobs SET provider_id=#{providerId},state=#{state} WHERE id=#{ident}")
    int bindProvider(@Param("schema") String schema, @Param("ident") String ident,
                     @Param("providerId") String providerId, @Param("state") String state);

    @Select("SELECT * FROM ${schema}video_jobs ORDER BY created_at,id")
    List<Map<String, Object>> allJobs(@Param("schema") String schema);

    @Select("SELECT * FROM ${schema}video_jobs WHERE id=#{ident}")
    Map<String, Object> job(@Param("schema") String schema, @Param("ident") String ident);
}
