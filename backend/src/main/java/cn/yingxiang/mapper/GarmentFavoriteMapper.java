package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.*;
import java.util.List;

@Mapper
public interface GarmentFavoriteMapper {
    @Select("SELECT garment_id FROM ${schema}garment_favorites WHERE user_id=#{user} ORDER BY created_at DESC,garment_id")
    List<String> list(@Param("schema") String schema,@Param("user") String user);

    @Insert("INSERT INTO ${schema}garment_favorites(user_id,garment_id,created_at) VALUES(#{user},#{id},#{now}) ON CONFLICT(user_id,garment_id) DO NOTHING")
    int add(@Param("schema") String schema,@Param("user") String user,@Param("id") String id,@Param("now") long now);

    @Delete("DELETE FROM ${schema}garment_favorites WHERE user_id=#{user} AND garment_id=#{id}")
    int remove(@Param("schema") String schema,@Param("user") String user,@Param("id") String id);
}
