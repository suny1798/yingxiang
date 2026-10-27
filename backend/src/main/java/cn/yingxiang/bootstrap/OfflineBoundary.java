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

/** M10-a 专用关闭边界；身份与业务接入后必须由后续切片显式替换。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public final class OfflineBoundary extends OncePerRequestFilter {
    private final JsonMapper json;
    private final String origin;
    private final String authority;
    private final Set<String> allowedAuthorities;
    private final Set<String> allowedOrigins;
    private final List<Route> routes;
    private final boolean accountReadEnabled;
    private final boolean authEnabled;
    private final boolean maintenance;

    public OfflineBoundary(Environment env, JsonMapper json) throws IOException {
        this.json = json;
        accountReadEnabled = env.getProperty("migration.account-read-enabled", Boolean.class, false);
        authEnabled = env.getProperty("migration.auth-enabled", Boolean.class, false);
        maintenance = env.getProperty("migration.maintenance", Boolean.class, true);
        Set<String> profiles = Set.copyOf(Arrays.asList(env.getActiveProfiles().length == 0
                ? env.getDefaultProfiles() : env.getActiveProfiles()));
        if (!(profiles.equals(Set.of("offline")) || profiles.equals(Set.of("local")))
                || !"127.0.0.1".equals(env.getProperty("server.address"))
                || !"/api".equals(env.getProperty("server.servlet.context-path", "/api"))
                || !"none".equalsIgnoreCase(env.getProperty("server.forward-headers-strategy", "none"))
                || (!maintenance && !authEnabled)
                || (authEnabled && !profiles.equals(Set.of("local")))
                || (authEnabled && !maintenance && env.getProperty("spring.datasource.hikari.read-only", Boolean.class, true))
                || env.getProperty("migration.allow-external-providers", Boolean.class, false)
                || env.getProperty("migration.scenes-enabled", Boolean.class, false)
                || env.getProperty("migration.stripe-live-enabled", Boolean.class, false)) {
            throw new IllegalStateException("M10-a requires the isolated migration configuration");
        }
        origin = env.getRequiredProperty("migration.public-origin");
        URI uri = URI.create(origin);
        if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty())) {
            throw new IllegalStateException("Invalid migration public origin");
        }
        authority = uri.getRawAuthority();
        allowedAuthorities = new LinkedHashSet<>(Set.of(authority));
        allowedOrigins = new LinkedHashSet<>(Set.of(origin));
        if (profiles.equals(Set.of("local"))) {
            int port = env.getProperty("server.port", Integer.class, 8792);
            for (String host : List.of("127.0.0.1", "localhost")) {
                allowedAuthorities.add(host + ":" + port);
                allowedOrigins.add("http://" + host + ":" + port);
            }
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

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        String method = request.getMethod();
        boolean safe = Set.of("GET", "HEAD", "OPTIONS").contains(method);
        boolean authPath = Set.of("/api/account/register", "/api/account/login", "/api/account/logout").contains(request.getRequestURI());
        if (authEnabled && maintenance && authPath && !safe) {
            error(request, response, 503, "MAINTENANCE", "服务维护中，请稍后再试。", requestId);
            return;
        }
        // 当前无启用的写能力。精确 Host/Origin 是本阶段跨站边界，不创建会话或接受转发头。
        boolean accountPath = request.getRequestURI().equals("/api/account/me") || authPath;
        boolean wrongHost = !allowedAuthorities.contains(request.getHeader("Host"))
                || "cross-site".equals(request.getHeader("Sec-Fetch-Site"));
        boolean wrongOrigin = (request.getHeader("Origin") != null && !allowedOrigins.contains(request.getHeader("Origin")))
                || (!safe && !allowedOrigins.contains(request.getHeader("Origin")));
        if (accountPath && request.getHeader("Origin") != null && !wrongOrigin) {
            wrongOrigin |= !URI.create(request.getHeader("Origin")).getRawAuthority().equals(request.getHeader("Host"));
        }
        if (wrongHost || wrongOrigin) {
            String code = accountPath ? wrongHost ? "LOCAL_ONLY" : "ORIGIN_REJECTED" : "ORIGIN_FORBIDDEN";
            String message = accountPath ? wrongHost ? "此验证入口仅允许本机页面访问。" : "页面来源不符，请从本机验证入口重新打开。" : "请求来源不被允许";
            error(request, response, 403, code, message, requestId);
            return;
        }
        String path = request.getRequestURI();
        if (Set.of("/api/internal/live", "/api/internal/ready").contains(path)) {
            if (!Set.of("GET", "HEAD", "OPTIONS").contains(method)) {
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
            response.setHeader("Allow", String.join(", ", allowed));
            error(request, response, 405, "METHOD_NOT_ALLOWED", "请求方法不被允许", requestId);
        } else if (method.equals("OPTIONS")) {
            response.setHeader("Allow", String.join(", ", allowed));
            response.setStatus(204);
        } else if (accountReadEnabled && path.equals("/api/account/me") && Set.of("GET", "HEAD").contains(method)) {
            chain.doFilter(request, response);
        } else if (authEnabled && !maintenance && authPath && method.equals("POST")) {
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
