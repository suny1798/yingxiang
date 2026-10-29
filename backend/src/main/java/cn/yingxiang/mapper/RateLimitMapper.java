package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/** 限流影子窗口与故障闸门 SQL；Redis 仍负责原子计数。 */
@Mapper
public interface RateLimitMapper {

    @Select("SELECT key,count,until FROM ${schema}auth_rate_limits WHERE until>#{now}")
    List<Map<String, Object>> importRows(@Param("schema") String schema, @Param("now") long now);

    @Select("SELECT until FROM ${schema}rate_limit_gates WHERE key=#{key}")
    List<Map<String, Object>> gate(@Param("schema") String schema, @Param("key") String key);

    @Insert("INSERT INTO ${schema}rate_limit_gates(key,until,reason,updated_at) VALUES (#{key},#{until},#{reason},#{now}) "
            + "ON CONFLICT(key) DO UPDATE SET until=GREATEST(rate_limit_gates.until,excluded.until),"
            + "reason=excluded.reason,updated_at=excluded.updated_at")
    int upsertGate(@Param("schema") String schema, @Param("key") String key, @Param("until") long until,
                   @Param("reason") String reason, @Param("now") long now);

    @Select("SELECT count,until FROM ${schema}rate_limit_shadows WHERE key=#{key}")
    Map<String, Object> shadow(@Param("schema") String schema, @Param("key") String key);

    @Insert("INSERT INTO ${schema}rate_limit_shadows(key,count,until,updated_at) VALUES (#{key},#{count},#{until},#{now}) "
            + "ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until,updated_at=excluded.updated_at")
    int upsertShadow(@Param("schema") String schema, @Param("key") String key, @Param("count") long count,
                     @Param("until") long until, @Param("now") long now);
}
