package cn.yingxiang.bootstrap;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Configuration
public class AccountSecurity {
    @Bean
    UserDetailsService noDefaultUser() {
        return username -> { throw new UsernameNotFoundException("No password login in M10-b"); };
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ObjectProvider<AccountReader> readers, JsonMapper json) throws Exception {
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(AbstractHttpConfigurer::disable).httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable).requestCache(AbstractHttpConfigurer::disable)
                // 仅已迁移账号与显式本机studio/支付/管理写接口复用前置精确Host/Origin校验。
                .csrf(csrf -> csrf.ignoringRequestMatchers("/account/register", "/account/login", "/account/logout",
                                "/studio/token", "/studio/observation", "/payments/**", "/admin/**", "/video/**", "/works/**", "/prompt/**"))
                .authorizeHttpRequests(auth -> auth.requestMatchers("/account/me", "/account/register", "/account/login",
                                "/account/logout", "/studio/status", "/studio/token", "/studio/observation",
                                "/payments/**", "/admin/**", "/site/announcement", "/video/**", "/works/**", "/prompt/**")
                        .permitAll().anyRequest().denyAll())
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, error) -> unavailable(request, response, json))
                        .accessDeniedHandler((request, response, error) -> unavailable(request, response, json)));
        AccountReader reader = readers.getIfAvailable();
        if (reader != null) http.addFilterBefore(new SessionFilter(reader, json), AnonymousAuthenticationFilter.class);
        return http.build();
    }

    static void unavailable(HttpServletRequest request, HttpServletResponse response, JsonMapper json) throws IOException {
        String id = response.getHeader("X-Request-Id");
        if (id == null) id = UUID.randomUUID().toString();
        byte[] bytes = json.writeValueAsBytes(Map.of("error", Map.of("code", "SERVICE_UNAVAILABLE", "message", "服务暂不可用，请刷新状态核查，不要重复提交。", "retryable", false), "requestId", id));
        response.setStatus(503); response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
        response.setContentLength(bytes.length);
        if (!request.getMethod().equals("HEAD")) response.getOutputStream().write(bytes);
    }

    private static final class SessionFilter extends OncePerRequestFilter {
        private final AccountReader reader;
        private final JsonMapper json;
        private SessionFilter(AccountReader reader, JsonMapper json) { this.reader = reader; this.json = json; }

        @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            if (request.getRequestURI().equals("/api/account/me") && List.of("GET", "HEAD").contains(request.getMethod())) {
                Map<String, Object> view;
                try { view = reader.read(AccountReader.cookieHash(request.getHeader("Cookie"))); }
                catch (RuntimeException error) { unavailable(request, response, json); return; }
                request.setAttribute("yingxiang.accountView", view);
                if (view.get("user") instanceof Map<?, ?> user) {
                    var auth = UsernamePasswordAuthenticationToken.authenticated(user.get("id"), null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + user.get("role").toString().toUpperCase(java.util.Locale.ROOT))));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            }
            chain.doFilter(request, response);
        }
    }
}
