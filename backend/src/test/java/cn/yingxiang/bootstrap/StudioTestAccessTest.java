package cn.yingxiang.bootstrap;

import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.AccountQueryMapper;
import cn.yingxiang.mapper.AccountReader;
import cn.yingxiang.mapper.EntitlementMapper;
import cn.yingxiang.service.impl.EntitlementReservationServiceImpl;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class StudioTestAccessTest {
    private static final String SCHEMA = "\"yingxiang_migration\".";
    private final EntitlementMapper mapper = mock(EntitlementMapper.class);
    private final MockEnvironment env = new MockEnvironment().withProperty("migration.db-schema", "yingxiang_migration")
            .withProperty("migration.studio-unlimited-usernames", "suny");

    private EntitlementReservationServiceImpl service() {
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        return new EntitlementReservationServiceImpl(mock(JdbcTemplate.class), mapper, manager, env);
    }

    private void login(String username) {
        when(mapper.lockSession(SCHEMA, "session")).thenReturn(List.of(Map.of("id", "owner", "username", username,
                "expires_at", System.currentTimeMillis() + 60_000)));
    }

    @Test void configuredTestUserKeepsAttemptWithoutConsumingOldGrant() {
        login("suny");
        var service = service();
        String id = UUID.randomUUID().toString();
        service.reserve("session", id, 30);
        verify(mapper).insertAttempt(eq(SCHEMA), eq(id), eq("owner"), isNull(), eq(30), anyLong());
        verify(mapper, never()).availableGrant(anyString(), anyString(), anyInt());
        when(mapper.lockAttempt(SCHEMA, id)).thenReturn(Map.of("user_id", "owner", "account_state", "review"));
        assertThat(service.confirmIssued(id)).isTrue();
        verify(mapper).markIssued(eq(SCHEMA), eq(id), anyLong());
        verify(mapper, never()).consumeGrant(anyString(), anyString(), anyString());
        verify(mapper, never()).insertEntry(anyString(), anyString(), anyString(), anyString(), anyString(), anyInt(), anyLong());
    }

    @Test void ordinaryUserStillNeedsGrantAndAnonymousCannotUseException() {
        login("ordinary");
        var service = service();
        assertThatThrownBy(() -> service.reserve("session", UUID.randomUUID().toString(), 15))
                .isInstanceOfSatisfying(BusinessFailure.class, e -> assertThat(e.getCode()).isEqualTo("TRIAL_USED"));
        when(mapper.lockSession(SCHEMA, "session")).thenReturn(List.of());
        assertThatThrownBy(() -> service.reserve("session", UUID.randomUUID().toString(), 15))
                .isInstanceOfSatisfying(BusinessFailure.class, e -> assertThat(e.getCode()).isEqualTo("LOGIN_REQUIRED"));
        verify(mapper, never()).insertAttempt(anyString(), anyString(), anyString(), any(), anyInt(), anyLong());
    }

    @Test void accountViewExposesTestAccessWithoutInventingQuota() {
        var queries = mock(AccountQueryMapper.class);
        when(queries.flywayV1(SCHEMA)).thenReturn(1);
        when(queries.readableTables("yingxiang_migration")).thenReturn(5);
        var reader = new AccountReader(queries, env);
        for (String username : List.of("suny", "ordinary")) {
            when(queries.sessionUser(eq(SCHEMA), eq("session"), anyLong())).thenReturn(Map.of(
                    "id", "owner", "username", username, "created_at", 0L, "role", "user"));
            var view = reader.read("session");
            assertThat(view.get("studioTestAccess")).isEqualTo(username.equals("suny"));
            assertThat(view.get("trialRemaining")).isEqualTo(0L);
        }
        assertThat(reader.read("")).doesNotContainKey("studioTestAccess");
    }

    @Test void videoTrialShowsOwnUnusedOrUsedStateWithoutTreatingTestAccessAsExtraFreeTrials() {
        env.withProperty("migration.video-free-trial-once", "true").withProperty("migration.video-unlimited-usernames", "suny");
        var queries = mock(AccountQueryMapper.class);
        when(queries.flywayV1(SCHEMA)).thenReturn(1);
        when(queries.readableTables("yingxiang_migration")).thenReturn(5);
        when(queries.sessionUser(eq(SCHEMA), eq("session"), anyLong())).thenReturn(Map.of(
                "id", "owner", "username", "suny", "created_at", 0L, "role", "user"));
        var reader = new AccountReader(queries, env);
        for (boolean used : List.of(false, true)) {
            when(queries.videoTrialUsed(SCHEMA, "owner", cn.yingxiang.common.FreeTrialPolicy.VIDEO_SINCE)).thenReturn(used);
            assertThat((Map<?, ?>) reader.read("session").get("videoTrial"))
                    .isEqualTo(Map.of("enabled", true, "limit", 1, "seconds", 10, "remaining", used ? 0 : 1, "unlimited", true));
        }
        reader.read("");
        verify(queries, times(2)).videoTrialUsed(SCHEMA, "owner", cn.yingxiang.common.FreeTrialPolicy.VIDEO_SINCE);
    }
}
