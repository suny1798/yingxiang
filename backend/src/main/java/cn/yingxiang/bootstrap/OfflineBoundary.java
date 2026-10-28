package cn.yingxiang.bootstrap;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** 迁移入口的显式关闭边界；每个切片只开放已实现且验证过的路径。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public final class OfflineBoundary extends OncePerRequestFilter {
    private final JsonMapper json;
    private final MigrationOrigin origin;
    private final List<Route> routes;
    private final boolean accountReadEnabled;
    private final boolean authEnabled;
    private final boolean maintenance;
    private final boolean studioFixtureEnabled;
    private final boolean paymentsEnabled;
    private final boolean adminEnabled;
    private final boolean videoEnabled;
    private final boolean worksEnabled;
    private final boolean promptEnabled;
    private final boolean compatibilityEnabled;

    @org.springframework.beans.factory.annotation.Autowired
    public OfflineBoundary(Environment env, JsonMapper json, MigrationOrigin origin) throws IOException {
        this.json = json; this.origin = origin;
        accountReadEnabled = env.getProperty("migration.account-read-enabled", Boolean.class, false);
        authEnabled = env.getProperty("migration.auth-enabled", Boolean.class, false);
        maintenance = env.getProperty("migration.maintenance", Boolean.class, true);
        studioFixtureEnabled = env.getProperty("migration.studio-fixture-enabled", Boolean.class, false);
        paymentsEnabled = env.getProperty("migration.payments-enabled", Boolean.class, false);
        adminEnabled = env.getProperty("migration.admin-enabled", Boolean.class, false);
        videoEnabled = env.getProperty("migration.video-enabled", Boolean.class, false);
        worksEnabled = env.getProperty("migration.works-enabled", Boolean.class, false);
        promptEnabled = env.getProperty("migration.prompt-enabled", Boolean.class, false);
        compatibilityEnabled = env.getProperty("migration.compatibility-enabled", Boolean.class, false);
        Set<String> profiles = Set.copyOf(Arrays.asList(env.getActiveProfiles().length == 0
                ? env.getDefaultProfiles() : env.getActiveProfiles()));
        boolean readOnly = env.getProperty("spring.datasource.hikari.read-only", Boolean.class, true);
        String schema = env.getProperty("migration.db-schema", "");
        if (!(profiles.equals(Set.of("offline")) || profiles.equals(Set.of("local")))
                || !"127.0.0.1".equals(env.getProperty("server.address"))
                || !"/api".equals(env.getProperty("server.servlet.context-path", "/api"))
                || !"none".equalsIgnoreCase(env.getProperty("server.forward-headers-strategy", "none"))
                || (!maintenance && !authEnabled)
                || (authEnabled && !profiles.equals(Set.of("local")))
                || (studioFixtureEnabled && (!authEnabled || !profiles.equals(Set.of("local"))))
                || (studioFixtureEnabled && (readOnly || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || (authEnabled && !maintenance && readOnly)
                || ((paymentsEnabled || adminEnabled) && (!profiles.equals(Set.of("local")) || readOnly
                    || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || (videoEnabled && (!profiles.equals(Set.of("local")) || readOnly
                    || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || (worksEnabled && (!profiles.equals(Set.of("local")) || readOnly
                    || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || (promptEnabled && (!profiles.equals(Set.of("local")) || readOnly
                    || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || (compatibilityEnabled && (!profiles.equals(Set.of("local")) || readOnly
                    || !schema.matches("yingxiang_migration_it_[a-f0-9]{12}")))
                || env.getProperty("migration.allow-external-providers", Boolean.class, false)
                || env.getProperty("migration.scenes-enabled", Boolean.class, false)
                || env.getProperty("migration.stripe-live-enabled", Boolean.class, false)) {
            throw new IllegalStateException("M10-a requires the isolated migration configuration");
        }
        try (var stream = getClass().getResourceAsStream("/migration-api-routes.json")) {
            if (stream == null) throw new IllegalStateException("Missing frozen route catalog");
            Catalog catalog = json.readValue(stream, Catalog.class);
            routes = catalog.routes().stream().map(spec -> {
                String regex = Arrays.stream(spec.path().split("/", -1))
                        .map(part -> part.startsWith("{") && part.endsWith("}") ? "[^/]+" : Pattern.quote(part))
                        .collect(java.util.stream.Collectors.joining("/"));
                Set<String> methods = new LinkedHashSet<>(spec.methods());
                if (methods.contains("GET")) methods.add("HEAD");
                methods.add("OPTIONS");
                return new Route(Pattern.compile("^" + regex + "$"), methods);
            }).toList();
        }
    }

    /** 仅测试入口：按同一环境构造来源校验。 */
    OfflineBoundary(Environment env, JsonMapper json) throws IOException {
        this(env, json, new MigrationOrigin(env));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        String method = request.getMethod();
        String path = request.getRequestURI();
        boolean safe = Set.of("GET", "HEAD", "OPTIONS").contains(method);
        boolean authPath = Set.of("/api/account/register", "/api/account/login", "/api/account/logout").contains(path);
        boolean studioPath = Set.of("/api/studio/status", "/api/studio/token", "/api/studio/observation").contains(path);
        boolean videoPath = videoEnabled && path.startsWith("/api/video/");
        boolean worksPath = worksEnabled && (path.equals("/api/works") || path.startsWith("/api/works/"));
        boolean promptPath = promptEnabled && path.startsWith("/api/prompt/");
        boolean compatibilityPath = compatibilityEnabled && path.startsWith("/api/v1/");
        boolean paymentPath = paymentsEnabled && path.startsWith("/api/payments/");
        boolean adminPath = adminEnabled && (path.startsWith("/api/admin/") || path.equals("/api/site/announcement"));
        if (maintenance && !safe && ((authEnabled && authPath) || (studioFixtureEnabled && studioPath)
                || paymentPath || adminPath || videoPath || worksPath || promptPath)) {
            error(request, response, 503, "MAINTENANCE", "服务维护中，请稍后再试。", requestId);
            return;
        }
        // 精确Host/Origin保护显式启用的接口，不接受转发头作为来源证据。
        // 支付写入口由控制器在支付门禁之后校验，保持旧入口“先门禁、后来源”的顺序。
        Set<String> knownMethods = new LinkedHashSet<>();
        routes.stream().filter(route -> route.pattern().matcher(path).matches())
                .forEach(route -> knownMethods.addAll(route.methods()));
        boolean methodMismatch = !knownMethods.isEmpty() && !knownMethods.contains(method);
        boolean protectedPath = path.equals("/api/account/me") || authPath || (studioFixtureEnabled && studioPath)
                || (adminPath && !path.equals("/api/site/announcement")) || videoPath || worksPath || promptPath;
        if (!paymentPath && !compatibilityPath && !methodMismatch) {
            boolean wrongHost = !origin.hostAllowed(request.getHeader("Host"))
                    || "cross-site".equals(request.getHeader("Sec-Fetch-Site"));
            String sent = request.getHeader("Origin");
            boolean wrongOrigin = (sent != null && !origin.originAllowed(sent)) || (!safe && sent == null);
            if (protectedPath && sent != null && !wrongOrigin) {
                wrongOrigin |= !URI.create(sent).getRawAuthority().equals(request.getHeader("Host"));
            }
            if (wrongHost || wrongOrigin) {
                String code = protectedPath ? wrongHost ? "LOCAL_ONLY" : "ORIGIN_REJECTED" : "ORIGIN_FORBIDDEN";
                String message = protectedPath ? wrongHost ? "此验证入口仅允许本机页面访问。" : "页面来源不符，请从本机验证入口重新打开。"
                        : "请求来源不被允许";
                error(request, response, 403, code, message, requestId);
                return;
            }
        }
        if (Set.of("/api/internal/live", "/api/internal/ready").contains(path)) {
            if (!safe) {
                response.setHeader("Allow", "GET, HEAD, OPTIONS");
                error(request, response, 405, "METHOD_NOT_ALLOWED", "请求方法不被允许", requestId);
            } else if (method.equals("OPTIONS")) {
                response.setHeader("Allow", "GET, HEAD, OPTIONS");
                response.setStatus(204);
            } else if (path.endsWith("/live")) {
                write(request, response, 200, Map.of("status", "ok", "component", "java-api"));
            } else {
                write(request, response, 503, Map.of("ready", false, "phase", "M10-a",
                        "reason", "BUSINESS_MIGRATION_PENDING"));
            }
            return;
        }
        Set<String> allowed = new LinkedHashSet<>();
        routes.stream().filter(route -> route.pattern().matcher(path).matches())
                .forEach(route -> allowed.addAll(route.methods()));
        if (allowed.isEmpty()) {
            error(request, response, 404, "NOT_FOUND", "接口不存在", requestId);
        } else if (!allowed.contains(method)) {
            if (Set.of("GET", "HEAD").contains(method)
                    && path.matches("^/api/(account|payments)/[^/]+$")) {
                error(request, response, 404, "NOT_FOUND", "接口不存在。", requestId);
                return;
            }
            response.setHeader("Allow", String.join(", ", allowed));
            error(request, response, 405, "METHOD_NOT_ALLOWED", "请求方法不被允许", requestId);
        } else if (method.equals("OPTIONS")) {
            response.setHeader("Allow", String.join(", ", allowed));
            response.setStatus(204);
        } else if (accountReadEnabled && path.equals("/api/account/me") && Set.of("GET", "HEAD").contains(method)) {
            chain.doFilter(request, response);
        } else if (authEnabled && !maintenance && authPath && method.equals("POST")) {
            chain.doFilter(request, response);
        } else if (studioFixtureEnabled && studioPath) {
            chain.doFilter(request, response);
        } else if (paymentPath || adminPath || videoPath || worksPath || promptPath || compatibilityPath) {
            chain.doFilter(request, response);
        } else {
            error(request, response, 503, "SERVICE_DISABLED", "Java业务迁移尚未完成", requestId);
        }
    }

    private void error(HttpServletRequest request, HttpServletResponse response, int status,
                       String code, String message, String id) throws IOException {
        write(request, response, status, Map.of("error", Map.of("code", code, "message", message,
                "retryable", false), "requestId", id));
    }

    private void write(HttpServletRequest request, HttpServletResponse response, int status, Object body)
            throws IOException {
        byte[] bytes = json.writeValueAsString(body).getBytes(StandardCharsets.UTF_8);
        response.setStatus(status);
        response.setContentType("application/json");
        response.setContentLength(bytes.length);
        if (!request.getMethod().equals("HEAD")) response.getOutputStream().write(bytes);
    }

    public record Spec(String path, List<String> methods) {}
    public record Catalog(String sourceSha256, List<Spec> routes) {}
    private record Route(Pattern pattern, Set<String> methods) {}
}
