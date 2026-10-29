package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** Worker 对账、任务认领与租约 SQL；保留 FOR UPDATE / SKIP LOCKED 与条件更新。 */
@Mapper
public interface WorkerMapper {

    @Insert("INSERT INTO ${schema}works(id,user_id,kind,source_id,title,state,mime,extension,bytes,chunks,"
            + "duration_ms,created_at,updated_at,error_code,retries,favorite) "
            + "SELECT gen_random_uuid()::text,j.user_id,'video',j.id,coalesce(h.title,'视频换装'),'waiting',"
            + "'video/mp4','mp4',0,0,j.seconds_milli,j.created_at,#{now},NULL,0,0 "
            + "FROM ${schema}video_jobs j LEFT JOIN ${schema}video_history h ON h.job_id=j.id "
            + "WHERE j.provider_id IS NOT NULL AND j.state IN ('pending','processing','completed') "
            + "ON CONFLICT (kind,source_id) DO NOTHING")
    int createVideoWorks(@Param("schema") String schema, @Param("now") long now);

    @Insert("INSERT INTO ${schema}background_tasks(id,type,user_id,resource_id,dedupe_key,state,attempts,"
            + "max_attempts,next_run_at,created_at,updated_at) "
            + "SELECT gen_random_uuid()::text,'video-save',w.user_id,w.id,'video-save:'||w.id,'pending',0,#{maxAttempts},#{now},#{now},#{now} "
            + "FROM ${schema}works w WHERE w.kind='video' AND w.state IN ('waiting','saving') "
            + "ON CONFLICT (dedupe_key) DO UPDATE SET state='pending',attempts=0,next_run_at=excluded.next_run_at,"
            + "last_error_code=NULL,lease_owner=NULL,lease_until=NULL,updated_at=excluded.updated_at "
            + "WHERE ${schema}background_tasks.state IN ('succeeded','failed','cancelled')")
    int enqueueVideoSave(@Param("schema") String schema, @Param("maxAttempts") int maxAttempts, @Param("now") long now);

    @Insert("INSERT INTO ${schema}background_tasks(id,type,user_id,resource_id,dedupe_key,state,attempts,"
            + "max_attempts,next_run_at,created_at,updated_at) "
            + "SELECT gen_random_uuid()::text,'cleanup',w.user_id,w.id,'cleanup:'||w.id,'pending',0,1,#{now},#{now},#{now} "
            + "FROM ${schema}works w WHERE w.state='deleted' ON CONFLICT (dedupe_key) DO NOTHING")
    int enqueueCleanup(@Param("schema") String schema, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state='failed',"
            + "last_error_code=coalesce(last_error_code,'ATTEMPTS_EXHAUSTED'),lease_owner=NULL,lease_until=NULL,"
            + "updated_at=#{now} WHERE state IN ('pending','running') AND attempts>=max_attempts "
            + "AND (lease_until IS NULL OR lease_until<#{now})")
    int failExhausted(@Param("schema") String schema, @Param("now") long now);

    @Select("SELECT id,user_id,chunks FROM ${schema}works WHERE state='capturing' AND updated_at<#{cutoff} "
            + "ORDER BY updated_at,id LIMIT 32")
    List<Map<String, Object>> capturingWorks(@Param("schema") String schema, @Param("cutoff") long cutoff);

    @Update("UPDATE ${schema}works SET state=#{state},error_code=#{error},updated_at=#{now} "
            + "WHERE id=#{ident} AND state='capturing' AND updated_at<#{cutoff}")
    int expireCapture(@Param("schema") String schema, @Param("ident") String ident, @Param("state") String state,
                      @Param("error") String error, @Param("now") long now, @Param("cutoff") long cutoff);

    @Insert("INSERT INTO ${schema}background_tasks(id,type,user_id,resource_id,dedupe_key,state,"
            + "attempts,max_attempts,next_run_at,created_at,updated_at) "
            + "VALUES (gen_random_uuid()::text,'capture-finish',#{userId},#{ident},'capture-finish:'||#{ident},"
            + "'pending',0,#{maxAttempts},#{now},#{now},#{now}) ON CONFLICT (dedupe_key) DO UPDATE SET state='pending',"
            + "attempts=0,next_run_at=excluded.next_run_at,lease_owner=NULL,lease_until=NULL,"
            + "updated_at=excluded.updated_at WHERE ${schema}background_tasks.state IN "
            + "('succeeded','failed','cancelled')")
    int enqueueCaptureFinish(@Param("schema") String schema, @Param("userId") String userId,
                             @Param("ident") String ident, @Param("maxAttempts") int maxAttempts,
                             @Param("now") long now);

    @Select("SELECT * FROM ${schema}background_tasks "
            + "WHERE state IN ('pending','running') AND attempts<max_attempts AND next_run_at<=#{now} "
            + "AND (lease_until IS NULL OR lease_until<#{now}) ORDER BY next_run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")
    Map<String, Object> claimTask(@Param("schema") String schema, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state='running',lease_owner=#{workerId},"
            + "lease_until=#{leaseUntil},lease_generation=#{generation},attempts=attempts+1,updated_at=#{now} "
            + "WHERE id=#{taskId} AND lease_generation=#{oldGeneration} AND state IN ('pending','running') "
            + "AND (lease_until IS NULL OR lease_until<#{now})")
    int markRunning(@Param("schema") String schema, @Param("workerId") String workerId,
                    @Param("leaseUntil") long leaseUntil, @Param("generation") long generation,
                    @Param("now") long now, @Param("taskId") String taskId, @Param("oldGeneration") long oldGeneration);

    @Update("UPDATE ${schema}video_jobs SET state=#{state} WHERE id=#{ident} AND state IN ('pending','processing')")
    int updateVideoState(@Param("schema") String schema, @Param("ident") String ident, @Param("state") String state);

    /** 分片合并前续租；已失去租约时不续，旧代次仍不能发布。 */
    @Update("UPDATE ${schema}background_tasks SET lease_until=#{leaseUntil} WHERE id=#{taskId} "
            + "AND lease_owner=#{workerId} AND lease_generation=#{generation} AND state='running' "
            + "AND lease_until>#{now}")
    int renewLease(@Param("schema") String schema, @Param("taskId") String taskId,
                   @Param("workerId") String workerId, @Param("generation") long generation,
                   @Param("leaseUntil") long leaseUntil, @Param("now") long now);

    @Select("SELECT lease_generation FROM ${schema}background_tasks WHERE id=#{taskId} AND lease_owner=#{workerId} "
            + "AND lease_generation=#{generation} AND state='running' AND lease_until>#{now} FOR UPDATE")
    List<Long> lockLease(@Param("schema") String schema, @Param("taskId") String taskId,
                         @Param("workerId") String workerId, @Param("generation") long generation,
                         @Param("now") long now);

    @Select("SELECT state FROM ${schema}works WHERE id=#{workId} FOR UPDATE")
    String lockWorkState(@Param("schema") String schema, @Param("workId") String workId);

    @Update("UPDATE ${schema}works SET state='ready',bytes=#{bytes},error_code=#{error},updated_at=#{now} "
            + "WHERE id=#{workId}")
    int markWorkReady(@Param("schema") String schema, @Param("workId") String workId, @Param("bytes") long bytes,
                      @Param("error") String error, @Param("now") long now);

    @Update("UPDATE ${schema}works SET state='ready',error_code=#{error},updated_at=#{now} WHERE id=#{workId}")
    int markWorkReadySimple(@Param("schema") String schema, @Param("workId") String workId,
                            @Param("error") String error, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state='succeeded',last_error_code=NULL,"
            + "lease_owner=NULL,lease_until=NULL,updated_at=#{now} WHERE id=#{taskId} AND lease_generation=#{generation}")
    int markTaskSucceeded(@Param("schema") String schema, @Param("taskId") String taskId,
                          @Param("generation") long generation, @Param("now") long now);

    @Update("UPDATE ${schema}works SET state='saving',retries=#{retries},updated_at=#{now} "
            + "WHERE id=#{workId} AND state IN ('waiting','saving')")
    int markWorkSaving(@Param("schema") String schema, @Param("workId") String workId,
                       @Param("retries") int retries, @Param("now") long now);

    @Update("UPDATE ${schema}works SET state='failed',error_code=#{code},updated_at=#{now} "
            + "WHERE id=#{workId} AND state IN ('waiting','saving')")
    int markWorkFailed(@Param("schema") String schema, @Param("workId") String workId,
                       @Param("code") String code, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state='pending',next_run_at=#{nextRunAt},last_error_code=#{code},"
            + "lease_owner=NULL,lease_until=NULL,updated_at=#{now} WHERE id=#{taskId} "
            + "AND lease_generation=#{generation} AND state='running'")
    int rescheduleTask(@Param("schema") String schema, @Param("taskId") String taskId,
                       @Param("generation") long generation, @Param("nextRunAt") long nextRunAt,
                       @Param("code") String code, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state='pending',next_run_at=#{nextRunAt},last_error_code=#{code},"
            + "lease_owner=NULL,lease_until=NULL,updated_at=#{now},attempts=0 WHERE id=#{taskId} "
            + "AND lease_generation=#{generation} AND state='running'")
    int rescheduleTaskReset(@Param("schema") String schema, @Param("taskId") String taskId,
                            @Param("generation") long generation, @Param("nextRunAt") long nextRunAt,
                            @Param("code") String code, @Param("now") long now);

    @Update("UPDATE ${schema}background_tasks SET state=#{state},last_error_code=#{code},lease_owner=NULL,"
            + "lease_until=NULL,updated_at=#{now} WHERE id=#{taskId} AND lease_generation=#{generation} AND state='running'")
    int completeTask(@Param("schema") String schema, @Param("taskId") String taskId,
                     @Param("generation") long generation, @Param("state") String state,
                     @Param("code") String code, @Param("now") long now);

    @Select("SELECT id,user_id,kind,source_id,state,extension,bytes,chunks,retries,error_code "
            + "FROM ${schema}works WHERE id=#{ident}")
    Map<String, Object> work(@Param("schema") String schema, @Param("ident") String ident);

    @Select("SELECT id,state,provider_id,expires_at FROM ${schema}video_jobs WHERE id=#{ident}")
    Map<String, Object> job(@Param("schema") String schema, @Param("ident") String ident);
}
