package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** 上传槽位租约 SQL。 */
@Mapper
public interface UploadMapper {

    @Select("INSERT INTO ${schema}upload_slots(id,owner,lease_generation,lease_until,updated_at) "
            + "VALUES (#{id},#{owner},1,#{leaseUntil},#{now}) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,"
            + "lease_generation=upload_slots.lease_generation+1,lease_until=excluded.lease_until,"
            + "updated_at=excluded.updated_at WHERE upload_slots.lease_until<#{now} "
            + "RETURNING lease_generation")
    Long acquire(@Param("schema") String schema, @Param("id") String id, @Param("owner") String owner,
                 @Param("leaseUntil") long leaseUntil, @Param("now") long now);

    @Delete("DELETE FROM ${schema}upload_slots WHERE id=#{id} AND owner=#{owner} AND lease_generation=#{generation}")
    int release(@Param("schema") String schema, @Param("id") String id, @Param("owner") String owner,
                @Param("generation") long generation);
}
