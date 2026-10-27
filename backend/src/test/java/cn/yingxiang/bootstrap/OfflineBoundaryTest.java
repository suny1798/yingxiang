package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "spring.profiles.active=offline")
@AutoConfigureMockMvc
class OfflineBoundaryTest {
    private static final String HOST = "127.0.0.1:8791";
    private static final String ORIGIN = "http://" + HOST;
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired org.springframework.context.ApplicationContext context;

    @Test void doesNotCreateDatabaseOrRedisConnections() {
        assertThat(context.getBeansOfType(javax.sql.DataSource.class)).isEmpty();
        assertThat(context.getBeansOfType(io.lettuce.core.RedisClient.class)).isEmpty();
    }

    @Test void processHealthDoesNotClaimBusinessReadiness() throws Exception {
        mvc.perform(get("/api/internal/live").contextPath("/api").header("Host", HOST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
        mvc.perform(get("/api/internal/ready").contextPath("/api").header("Host", HOST))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.ready").value(false));
    }

    @Test void localProfileAllowsNormalDirectBackendRequests() throws Exception {
        var env = base().withProperty("server.port", "8792");
        env.setActiveProfiles("local");
        var filter = new OfflineBoundary(env, json);
        var request = new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/internal/live");
        request.addHeader("Host", "localhost:8792");
        var response = new org.springframework.mock.web.MockHttpServletResponse();
        filter.doFilter(request, response, new org.springframework.mock.web.MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test void everyFrozenOperationRemainsDisabled() throws Exception {
        try (var stream = getClass().getResourceAsStream("/migration-api-routes.json")) {
            var catalog = json.readValue(stream, OfflineBoundary.Catalog.class);
            for (var route : catalog.routes()) {
                String path = route.path().replaceAll("\\{[^}]+}", "synthetic-id");
                for (String method : route.methods()) {
                    mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method), path)
                                    .contextPath("/api").header("Host", HOST).header("Origin", ORIGIN)
                                    .header("Cookie", "session=synthetic-untrusted"))
                            .andExpect(status().isServiceUnavailable())
                            .andExpect(jsonPath("$.error.code").value("SERVICE_DISABLED"))
                            .andExpect(header().string("Cache-Control", "no-store"))
                            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                            .andExpect(header().doesNotExist("Set-Cookie"))
                            .andExpect(header().doesNotExist("WWW-Authenticate"))
                            .andExpect(header().doesNotExist("Location"));
                }
            }
        }
    }

    @Test void unknownAndUnsupportedMethodsAreExplicit() throws Exception {
        mvc.perform(get("/api/not-real").contextPath("/api").header("Host", HOST))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.requestId").isString());
        mvc.perform(post("/api/internal/live").contextPath("/api").header("Host", HOST).header("Origin", ORIGIN))
                .andExpect(status().isMethodNotAllowed()).andExpect(header().string("Allow", "GET, HEAD, OPTIONS"));
        mvc.perform(post("/api/admin/overview").contextPath("/api").header("Host", HOST).header("Origin", ORIGIN))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(head("/api/internal/live").contextPath("/api").header("Host", HOST))
                .andExpect(status().isOk()).andExpect(content().string(""));
        mvc.perform(options("/api/internal/live").contextPath("/api").header("Host", HOST))
                .andExpect(status().isNoContent()).andExpect(content().string(""));
    }

    @Test void rejectsCrossSiteAndForgedForwarding() throws Exception {
        mvc.perform(get("/api/internal/live").contextPath("/api").header("Host", "evil.example")
                        .header("X-Forwarded-Host", HOST)).andExpect(status().isForbidden());
        mvc.perform(get("/api/internal/live").contextPath("/api").header("Host", HOST).header("Origin", "https://evil.example"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/internal/live").contextPath("/api").header("Host", HOST).header("Sec-Fetch-Site", "cross-site"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/not-real").contextPath("/api").header("Host", HOST)).andExpect(status().isForbidden());
        mvc.perform(get("/api/internal/live").contextPath("/api").header("Host", HOST).header("X-Request-Id", "untrusted"))
                .andExpect(header().string("X-Request-Id", org.hamcrest.Matchers.not("untrusted")));
    }

    @Test void refusesUnsafeSettings() {
        for (String key : List.of("migration.allow-external-providers", "migration.scenes-enabled", "migration.stripe-live-enabled")) {
            assertThatThrownBy(() -> new OfflineBoundary(base().withProperty(key, "true"), json))
                    .isInstanceOf(IllegalStateException.class);
        }
        assertThatThrownBy(() -> new OfflineBoundary(base().withProperty("migration.maintenance", "false"), json))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OfflineBoundary(base().withProperty("server.address", "0.0.0.0"), json))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OfflineBoundary(base().withProperty("server.forward-headers-strategy", "framework"), json))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OfflineBoundary(base().withProperty("server.servlet.context-path", "/"), json))
                .isInstanceOf(IllegalStateException.class);
        var wrongProfile = base();
        wrongProfile.setActiveProfiles("production");
        assertThatThrownBy(() -> new OfflineBoundary(wrongProfile, json)).isInstanceOf(IllegalStateException.class);
    }

    @Test void routeCatalogTracksFrozenContract() throws Exception {
        byte[] source = Files.readString(Path.of("../docs/api/openapi.json"), java.nio.charset.StandardCharsets.UTF_8)
                .replace("\r\n", "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try (var stream = getClass().getResourceAsStream("/migration-api-routes.json")) {
            var catalog = json.readValue(stream, OfflineBoundary.Catalog.class);
            assertThat(catalog.sourceSha256()).isEqualTo(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source)));
            assertThat(catalog.routes()).hasSize(44);
            var paths = json.readTree(source).get("paths");
            for (var route : catalog.routes()) {
                var operation = paths.get(route.path());
                assertThat(operation).isNotNull();
                for (String method : route.methods()) {
                    assertThat(operation.has(method.toLowerCase(java.util.Locale.ROOT))).isTrue();
                }
            }
        }
    }

    private MockEnvironment base() {
        var env = new MockEnvironment().withProperty("server.address", "127.0.0.1")
                .withProperty("migration.public-origin", ORIGIN);
        env.setDefaultProfiles("offline");
        return env;
    }
}
