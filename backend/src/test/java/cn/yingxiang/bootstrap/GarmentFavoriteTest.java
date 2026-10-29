package cn.yingxiang.bootstrap;

import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.GarmentFavoriteMapper;
import cn.yingxiang.service.impl.GarmentFavoriteServiceImpl;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class GarmentFavoriteTest {
    private MockEnvironment env(boolean maintenance){return new MockEnvironment().withProperty("migration.db-schema","yingxiang_migration").withProperty("migration.maintenance",String.valueOf(maintenance));}
    @Test void listIsBoundToCurrentUser(){
        var mapper=mock(GarmentFavoriteMapper.class);var service=new GarmentFavoriteServiceImpl(mapper,env(false));
        when(mapper.list("\"yingxiang_migration\".","owner-a")).thenReturn(List.of("SPR-0001"));
        assertThat(service.list("owner-a")).containsExactly("SPR-0001");
        verify(mapper).list("\"yingxiang_migration\".","owner-a");
    }
    @Test void knownCatalogIdCanBeSavedAndRemoved(){
        var mapper=mock(GarmentFavoriteMapper.class);var service=new GarmentFavoriteServiceImpl(mapper,env(false));
        service.set("owner-a","SPR-0001",true);service.set("owner-a","SPR-0001",false);
        verify(mapper).add(eq("\"yingxiang_migration\"."),eq("owner-a"),eq("SPR-0001"),anyLong());
        verify(mapper).remove("\"yingxiang_migration\".","owner-a","SPR-0001");
    }
    @Test void nonexistentIdsAndMaintenanceNeverWrite(){
        var mapper=mock(GarmentFavoriteMapper.class);var service=new GarmentFavoriteServiceImpl(mapper,env(false));
        for(String id:List.of("SPR-9999","../../secret","https://other.test/a"))assertThatThrownBy(()->service.set("owner",id,true)).isInstanceOfSatisfying(BusinessFailure.class,e->assertThat(e.getStatus()).isEqualTo(404));
        assertThatThrownBy(()->new GarmentFavoriteServiceImpl(mapper,env(true)).set("owner","SPR-0001",true)).isInstanceOfSatisfying(BusinessFailure.class,e->assertThat(e.getStatus()).isEqualTo(503));
        verifyNoInteractions(mapper);
    }
}
