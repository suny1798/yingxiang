package cn.yingxiang.controller;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.config.RuntimePolicy;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** M20：旧公开配置／健康与已停用会话接口的兼容边界；不启用旧会话写入。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "migration.compatibility-enabled", havingValue = "true")
public class CompatibilityController {
    private final JsonMapper json;
    private final boolean studio;

    public CompatibilityController(JsonMapper json, Environment env) {
        this.json = json;
        this.studio = env.getProperty("migration.studio-fixture-enabled", Boolean.class, false) || (RuntimePolicy.runtime(env) && env.getProperty("migration.studio-enabled", Boolean.class, false));
    }

    @GetMapping("/v1/config")
    public void config(HttpServletRequest request, HttpServletResponse response) throws IOException {
        Map<String, Object> image = new LinkedHashMap<>();
        image.put("maxBytes", 10_485_760); image.put("maxPixels", 20_000_000); image.put("maxEdge", 1024);
        image.put("mimeTypes", List.of("image/jpeg", "image/png", "image/webp"));
        Map<String, Object> features = new LinkedHashMap<>();
        features.put("camera", true); features.put("realtime", studio); features.put("invitations", false);
        features.put("promptEditing", false);
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("apiVersion", "v1"); value.put("mode", "real"); value.put("scene", "clothing");
        value.put("maxDurationSec", 60); value.put("defaultDurationSec", 15);
        value.put("durationOptions", List.of(15, 30, 60));
        value.put("consentVersion", "2026-10-23-preview-cloud-v2");
        value.put("image", image); value.put("features", features);
        MigrationSupport.ok(response, json, value, 200);
    }

    @GetMapping("/v1/health")
    public void health(HttpServletRequest request, HttpServletResponse response) throws IOException {
        MigrationSupport.ok(response, json, MigrationSupport.body("status", "ok", "application", "yingxiang",
                "mode", "real", "providerReady", false, "storageReady", false), 200);
    }

    @PostMapping({"/v1/access/redeem", "/v1/sessions", "/v1/sessions/{ident}/token",
            "/v1/sessions/{ident}/heartbeat", "/v1/sessions/{ident}/end"})
    public void disabled(HttpServletRequest request, HttpServletResponse response) throws IOException {
        MigrationSupport.failure(response, json,
                new BusinessFailure("SERVICE_DISABLED", "账号与会话服务尚未启用。", 503));
    }
}
