package cn.yingxiang.service;

import java.util.List;

public interface GarmentFavoriteService {
    List<String> list(String user);
    void set(String user,String id,boolean favorite);
}
