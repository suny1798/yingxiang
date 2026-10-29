package cn.yingxiang.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 全局跨域配置。
 *
 * <p>正式入口由 Nginx 同源提供，跨域只服务本机隔离预览（Vite 8791）。
 * 不使用 {@code allowedOriginPatterns("*")}，避免携带 Cookie 的请求被任意站点调用。</p>
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final Set<String> allowedOrigins;

    public CorsConfig(@Value("${migration.public-origin:http://127.0.0.1:8791}") String publicOrigin,
                      @Value("${migration.cors-allowed-origins:}") String extraOrigins) {
        Set<String> origins = new LinkedHashSet<>();
        origins.add(publicOrigin);
        origins.add("http://127.0.0.1:8791");
        origins.add("http://localhost:8791");
        for (String value : split(extraOrigins)) {
            origins.add(value);
        }
        this.allowedOrigins = Set.copyOf(origins);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowCredentials(true)
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("X-Request-Id")
                .maxAge(1800);
    }

    private static List<String> split(String value) {
        List<String> result = new ArrayList<>();
        if (value == null || value.isBlank()) {
            return result;
        }
        for (String part : value.split(",")) {
            String origin = part.strip();
            if (!origin.isEmpty()) {
                result.add(origin);
            }
        }
        return result;
    }
}
