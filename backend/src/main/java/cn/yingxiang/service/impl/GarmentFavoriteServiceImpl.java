package cn.yingxiang.service.impl;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.GarmentFavoriteMapper;
import cn.yingxiang.service.GarmentFavoriteService;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@Profile("local")
public class GarmentFavoriteServiceImpl implements GarmentFavoriteService {
    private static final Set<String> IDS=loadIds();
    private final GarmentFavoriteMapper mapper;
    private final String schema;
    private final boolean maintenance;
    public GarmentFavoriteServiceImpl(GarmentFavoriteMapper mapper,Environment env){
        this.mapper=mapper;this.schema=MigrationSupport.quotedSchema(env);
        this.maintenance=env.getProperty("migration.maintenance",Boolean.class,true);
    }
    private static Set<String> loadIds(){
        try(var stream=GarmentFavoriteServiceImpl.class.getResourceAsStream("/garment-library-ids.txt")){
            if(stream==null)throw new IllegalStateException("Missing garment catalog");
            return new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).lines().filter(s->!s.isBlank()).collect(Collectors.toUnmodifiableSet());
        }catch(java.io.IOException error){throw new IllegalStateException("Cannot read garment catalog");}
    }
    public List<String> list(String user){return mapper.list(schema,user);}
    public void set(String user,String id,boolean favorite){
        if(maintenance)throw new BusinessFailure("MAINTENANCE","服务维护中，暂时无法保存收藏。",503);
        if(!IDS.contains(id))throw new BusinessFailure("GARMENT_NOT_FOUND","找不到这套衣装。",404);
        if(favorite)mapper.add(schema,user,id,System.currentTimeMillis());else mapper.remove(schema,user,id);
    }
}
