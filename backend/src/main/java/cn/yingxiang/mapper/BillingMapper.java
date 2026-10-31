package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface BillingMapper {
    @Select("SELECT result_duration_ms FROM ${schema}video_jobs WHERE id=#{id}")
    Long videoDuration(@Param("schema") String schema, @Param("id") String id);
    @Select("SELECT c.id,j.provider_id,j.state FROM ${schema}billing_credit_charges c JOIN ${schema}video_jobs j ON j.id=c.id WHERE c.scene='video' AND c.state IN ('reserved','review') AND j.provider_id IS NOT NULL ORDER BY c.created_at LIMIT 20")
    List<Map<String,Object>> pendingVideos(@Param("schema") String schema);
    @Insert("INSERT INTO ${schema}billing_credit_wallets(user_id,environment) VALUES(#{userId},#{environment}) ON CONFLICT DO NOTHING")
    int ensure(@Param("schema") String schema, @Param("userId") String userId, @Param("environment") String environment);

    @Select("SELECT * FROM ${schema}billing_credit_wallets WHERE user_id=#{userId} AND environment=#{environment} FOR UPDATE")
    Map<String,Object> lock(@Param("schema") String schema, @Param("userId") String userId, @Param("environment") String environment);

    @Select("SELECT * FROM ${schema}billing_credit_wallets WHERE user_id=#{userId} AND environment=#{environment}")
    Map<String,Object> wallet(@Param("schema") String schema, @Param("userId") String userId, @Param("environment") String environment);

    @Update("UPDATE ${schema}billing_credit_wallets SET available_credits=available_credits+#{available},reserved_credits=reserved_credits+#{reserved},spent_credits=spent_credits+#{spent} WHERE user_id=#{userId} AND environment=#{environment}")
    int change(@Param("schema") String schema, @Param("userId") String userId, @Param("environment") String environment,
               @Param("available") long available, @Param("reserved") long reserved, @Param("spent") long spent);

    @Select("SELECT * FROM ${schema}billing_credit_entries WHERE operation_key=#{key}")
    Map<String,Object> entry(@Param("schema") String schema, @Param("key") String key);

    @Insert("INSERT INTO ${schema}billing_credit_entries(operation_key,user_id,environment,kind,available_credits_delta,reserved_credits_delta,spent_credits_delta,paid_minor,currency,created_at) VALUES(#{key},#{userId},#{environment},#{kind},#{available},#{reserved},#{spent},#{paid},#{currency},#{now})")
    int insertEntry(@Param("schema") String schema, @Param("key") String key, @Param("userId") String userId,
                    @Param("environment") String environment, @Param("kind") String kind, @Param("available") long available,
                    @Param("reserved") long reserved, @Param("spent") long spent, @Param("paid") Long paid,
                    @Param("currency") String currency, @Param("now") long now);

    @Select("SELECT * FROM ${schema}billing_credit_charges WHERE id=#{id}")
    Map<String,Object> charge(@Param("schema") String schema, @Param("id") String id);

    @Select("SELECT * FROM ${schema}billing_credit_charges WHERE id=#{id} FOR UPDATE")
    Map<String,Object> lockCharge(@Param("schema") String schema, @Param("id") String id);

    @Insert("INSERT INTO ${schema}billing_credit_charges(id,user_id,environment,scene,version,reserved_ms,reserved_credits,state,created_at) VALUES(#{id},#{userId},#{environment},#{scene},'credits-v2',#{milliseconds},#{amount},'reserved',#{now})")
    int reserve(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                @Param("environment") String environment, @Param("scene") String scene,
                @Param("milliseconds") long milliseconds, @Param("amount") long amount, @Param("now") long now);

    @Update("UPDATE ${schema}billing_credit_charges SET settled_ms=#{milliseconds},charged_credits=#{amount},state=#{state},settled_at=#{now} WHERE id=#{id} AND state IN ('reserved','review')")
    int settle(@Param("schema") String schema, @Param("id") String id, @Param("milliseconds") long milliseconds,
               @Param("amount") long amount, @Param("state") String state, @Param("now") long now);

    @Update("UPDATE ${schema}billing_credit_charges SET state='review' WHERE id=#{id} AND state='reserved'")
    int review(@Param("schema") String schema, @Param("id") String id);

    @Select("SELECT id,scene,state,reserved_ms,settled_ms,reserved_credits,charged_credits,created_at FROM ${schema}billing_credit_charges WHERE user_id=#{userId} AND environment=#{environment} ORDER BY created_at DESC,id DESC LIMIT 20")
    List<Map<String,Object>> history(@Param("schema") String schema, @Param("userId") String userId, @Param("environment") String environment);
}
