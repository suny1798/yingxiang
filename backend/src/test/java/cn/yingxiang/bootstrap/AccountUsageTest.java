package cn.yingxiang.bootstrap;

import cn.yingxiang.mapper.AccountQueryMapper;
import cn.yingxiang.mapper.AccountReader;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AccountUsageTest {
    @Test void verifiedUsageShowsActualChargeAndRefundWhileUnchargedHistoryStaysUnknown() {
        var queries=mock(AccountQueryMapper.class);
        String schema="\"yingxiang_migration\".";
        when(queries.flywayV1(schema)).thenReturn(1);
        when(queries.readableTables("yingxiang_migration")).thenReturn(5);
        when(queries.sessionUser(eq(schema),eq("session"),anyLong())).thenReturn(Map.of("id","one","username","one","created_at",1L,"role","user"));
        when(queries.history(schema,"one")).thenReturn(List.of(
                Map.of("id","paid","kind","video","created_at",1L,"seconds",5.034,"status","completed","result_duration_ms",4934L,"billing_state","settled","reserved_credits",6L,"charged_credits",5L),
                Map.of("id","test","kind","realtime","created_at",1L,"seconds",15,"status","ended")));
        var reader=new AccountReader(queries,new MockEnvironment().withProperty("migration.db-schema","yingxiang_migration"));
        var history=(List<Map<String,Object>>)reader.read("session").get("history");
        assertThat(history.getFirst().get("durationSec")).isEqualTo(5.034);
        assertThat(history.getFirst().get("resultDurationSec")).isEqualTo(4.934);
        assertThat((Map<String,Object>)history.getFirst().get("billing")).containsEntry("chargedCredits",5L).containsEntry("returnedCredits",1L);
        assertThat(history.getLast().get("billing")).isNull();
        assertThat(history.getLast().get("resultDurationSec")).isNull();
    }
}
