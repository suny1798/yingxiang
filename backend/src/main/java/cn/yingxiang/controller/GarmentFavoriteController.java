package cn.yingxiang.controller;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.config.MigrationOrigin;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.AccountReader;
import cn.yingxiang.mapper.MigrationAccounts;
import cn.yingxiang.service.GarmentFavoriteService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.util.Map;

@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
public class GarmentFavoriteController {
    private final GarmentFavoriteService service;
    private final MigrationAccounts accounts;
    private final MigrationOrigin origin;
    private final JsonMapper json;
    public GarmentFavoriteController(GarmentFavoriteService service,MigrationAccounts accounts,MigrationOrigin origin,JsonMapper json){
        this.service=service;this.accounts=accounts;this.origin=origin;this.json=json;
    }
    private String user(HttpServletRequest request,boolean write){
        origin.require(request,write);
        String user=accounts.require(AccountReader.cookieHash(request.getHeader("Cookie"))).id();
        if(!user.equals(request.getHeader("X-Garment-Owner")))throw new BusinessFailure("GARMENT_OWNER_CHANGED","账号已变更，请重新读取收藏。",409);
        return user;
    }
    @GetMapping("/garments/favorites")
    public void list(HttpServletRequest request,HttpServletResponse response)throws IOException{
        try{MigrationSupport.ok(response,json,Map.of("ids",service.list(user(request,false))));}
        catch(RuntimeException error){MigrationSupport.failure(response,json,error);}
    }
    @PostMapping("/garments/{id}/favorite")
    public void set(HttpServletRequest request,HttpServletResponse response,@PathVariable String id)throws IOException{
        try{
            String user=user(request,true);
            var body=MigrationSupport.readJson(request,json,1024,true);
            if(body.size()!=1||!body.has("favorite")||!body.get("favorite").isBoolean())throw new BusinessFailure("INVALID_GARMENT_FAVORITE","衣装收藏状态无效。",400);
            boolean favorite=body.get("favorite").asBoolean();service.set(user,id,favorite);
            MigrationSupport.ok(response,json,Map.of("id",id,"favorite",favorite));
        }catch(RuntimeException error){MigrationSupport.failure(response,json,error);}
    }
}
