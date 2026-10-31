package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/**
 * 作品固定 SQL。
 *
 * <p>列表搜索的动态条件与排序仍由 WorksServiceImpl 构造后执行；
 * 这里的写入保持原 WHERE 条件与原子语义。</p>
 */
@Mapper
public interface WorksMapper {

    @Select("SELECT * FROM ${schema}works WHERE id=#{ident} AND user_id=#{userId}")
    Map<String, Object> own(@Param("schema") String schema, @Param("ident") String ident, @Param("userId") String userId);

    @Select("SELECT * FROM ${schema}works WHERE id=#{ident}")
    Map<String, Object> byId(@Param("schema") String schema, @Param("ident") String ident);

    @Select("SELECT * FROM ${schema}work_references WHERE work_id=#{workId} ORDER BY created_at,id")
    List<Map<String, Object>> references(@Param("schema") String schema, @Param("workId") String workId);

    @Insert("INSERT INTO ${schema}works(id,user_id,kind,title,state,mime,extension,bytes,chunks,duration_ms,"
            + "created_at,updated_at,retries,favorite) VALUES (#{id},#{userId},#{kind},#{title},#{state},#{mime},"
            + "#{extension},#{bytes},#{chunks},#{durationMs},#{createdAt},#{updatedAt},#{retries},#{favorite})")
    int insert(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
               @Param("kind") String kind, @Param("title") String title, @Param("state") String state,
               @Param("mime") String mime, @Param("extension") String extension, @Param("bytes") long bytes,
               @Param("chunks") int chunks, @Param("durationMs") long durationMs, @Param("createdAt") long createdAt,
               @Param("updatedAt") long updatedAt, @Param("retries") int retries, @Param("favorite") int favorite);

    @Update("UPDATE ${schema}works SET chunks=#{chunks},bytes=#{bytes},updated_at=#{updatedAt} "
            + "WHERE id=#{ident} AND state='capturing'")
    int updateChunks(@Param("schema") String schema, @Param("ident") String ident, @Param("chunks") int chunks,
                     @Param("bytes") long bytes, @Param("updatedAt") long updatedAt);

    @Update("UPDATE ${schema}works SET duration_ms=#{durationMs} WHERE id=#{ident}")
    int updateDuration(@Param("schema") String schema, @Param("ident") String ident,
                       @Param("durationMs") int durationMs);

    @Update("UPDATE ${schema}works SET state=#{state},error_code=#{error},updated_at=#{updatedAt} "
            + "WHERE id=#{ident} AND state<>'deleted'")
    int updateState(@Param("schema") String schema, @Param("ident") String ident, @Param("state") String state,
                    @Param("error") String error, @Param("updatedAt") long updatedAt);

    @Update("UPDATE ${schema}works SET state=#{state},error_code=#{error},retries=#{retries},updated_at=#{updatedAt} "
            + "WHERE id=#{ident} AND state<>'deleted'")
    int updateStateRetries(@Param("schema") String schema, @Param("ident") String ident, @Param("state") String state,
                           @Param("error") String error, @Param("retries") int retries,
                           @Param("updatedAt") long updatedAt);

    @Insert("INSERT INTO ${schema}work_references(id,work_id,mime,extension,bytes,created_at) "
            + "VALUES (#{id},#{workId},#{mime},#{extension},#{bytes},#{createdAt})")
    int insertReference(@Param("schema") String schema, @Param("id") String id, @Param("workId") String workId,
                        @Param("mime") String mime, @Param("extension") String extension, @Param("bytes") long bytes,
                        @Param("createdAt") long createdAt);

    @Insert("INSERT INTO ${schema}works(id,user_id,kind,source_id,title,state,mime,extension,bytes,chunks,"
            + "duration_ms,created_at,updated_at,error_code,retries,favorite) "
            + "SELECT gen_random_uuid()::text,j.user_id,'video',j.id,coalesce(h.title,'视频换装'),'waiting',"
            + "'video/mp4','mp4',0,0,j.seconds_milli,j.created_at,#{now},NULL,0,0 "
            + "FROM ${schema}video_jobs j LEFT JOIN ${schema}video_history h ON h.job_id=j.id "
            + "WHERE j.id=#{jobId} ON CONFLICT (kind,source_id) DO NOTHING")
    int ensureVideoWork(@Param("schema") String schema, @Param("jobId") String jobId, @Param("now") long now);

    @Select("SELECT * FROM ${schema}works WHERE kind='video' AND source_id=#{jobId}")
    Map<String, Object> videoWork(@Param("schema") String schema, @Param("jobId") String jobId);

    @Update("UPDATE ${schema}works SET error_code='REFERENCE_SAVE_FAILED',updated_at=#{now} "
            + "WHERE kind='video' AND source_id=#{jobId} AND state IN ('waiting','saving')")
    int markVideoReferenceFailed(@Param("schema") String schema, @Param("jobId") String jobId, @Param("now") long now);

    @Update("UPDATE ${schema}works SET title=#{title},updated_at=#{updatedAt} WHERE id=#{ident}")
    int updateTitle(@Param("schema") String schema, @Param("ident") String ident, @Param("title") String title,
                    @Param("updatedAt") long updatedAt);

    @Update("UPDATE ${schema}works SET favorite=#{favorite} WHERE id=#{ident}")
    int updateFavorite(@Param("schema") String schema, @Param("ident") String ident, @Param("favorite") int favorite);

    @Update("UPDATE ${schema}works SET state='deleted',title='',favorite=0,error_code=NULL,updated_at=#{updatedAt} "
            + "WHERE id=#{ident}")
    int markDeleted(@Param("schema") String schema, @Param("ident") String ident, @Param("updatedAt") long updatedAt);

    @Delete("DELETE FROM ${schema}work_references WHERE work_id=#{ident}")
    int deleteReferences(@Param("schema") String schema, @Param("ident") String ident);
}
