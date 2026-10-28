package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 精确Host/Origin来源证据；不接受转发头，与旧local_origin同义。 */
@Component
public class MigrationOrigin {
    private final String origin;
    private final Set<String> authorities;
    private final Set<String> origins;

    public MigrationOrigin(Environment env) {
        origin = env.getRequiredProperty("migration.public-origin");
        URI uri = URI.create(origin);
        if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty())) {
            throw new IllegalStateException("Invalid migration public origin");
        }
        authorities = new LinkedHashSet<>(Set.of(uri.getRawAuthority()));
        origins = new LinkedHashSet<>(Set.of(origin));
        if (Set.of(env.getActiveProfiles()).equals(Set.of("local"))) {
            int port = env.getProperty("server.port", Integer.class, 8792);
            for (String host : List.of("127.0.0.1", "localhost")) {
                authorities.add(host + ":" + port);
                origins.add("http://" + host + ":" + port);
            }
        }
    }

    public String publicOrigin() { return origin; }
    public boolean hostAllowed(String host) { return host != null && authorities.contains(host); }
    public boolean originAllowed(String value) { return value != null && origins.contains(value); }

    /** mutation=true时要求Origin必须存在；GET带Origin时同样校验。 */
    public String require(HttpServletRequest request, boolean mutation) {
        String host = request.getHeader("Host");
        if (!hostAllowed(host) || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
            throw new BusinessFailure("LOCAL_ONLY", "此验证入口仅允许本机页面访问。", 403);
        }
        String sent = request.getHeader("Origin");
        String expected = origins.stream().filter(value -> URI.create(value).getRawAuthority().equals(host))
                .findFirst().orElse("");
        if ((mutation || sent != null) && !java.util.Objects.equals(sent, expected)) {
            throw new BusinessFailure("ORIGIN_REJECTED", "页面来源不符，请从本机验证入口重新打开。", 403);
        }
        return expected;
    }
}
