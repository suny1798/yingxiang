package cn.yingxiang.controller;

import cn.yingxiang.config.MigrationOrigin;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.service.AdministrationService;
import cn.yingxiang.mapper.AccountReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Map;

/** M13-b路由：先精确来源，再管理员身份，最后读取受限请求体。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.admin-enabled", havingValue = "true")
public class AdminController {
    private final AdministrationService service;
    private final MigrationOrigin origin;
    private final JsonMapper json;

    public AdminController(AdministrationService service, MigrationOrigin origin, JsonMapper json) {
        this.service = service; this.origin = origin; this.json = json;
    }

    @GetMapping("/admin/overview")
    public void overview(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, () -> service.overview(cookie(request)));
    }

    @GetMapping("/admin/users")
    public void users(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, () -> {
            String query = query(request, "q", 80).strip();
            int page = page(request);
            return service.listUsers(cookie(request), query, page);
        });
    }

    @PostMapping("/admin/users/{ident}")
    public void userChange(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, true, () -> service.userChange(cookie(request), ident,
                MigrationSupport.readJson(request, json, 4096, false)));
    }

    @PostMapping("/admin/users/{ident}/quota")
    public void quotaChange(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, true, () -> service.quotaChange(cookie(request), ident,
                MigrationSupport.readJson(request, json, 4096, false)));
    }

    @GetMapping("/admin/records/{kind}")
    public void records(HttpServletRequest request, HttpServletResponse response, @PathVariable String kind) throws IOException {
        run(request, response, () -> {
            if (!java.util.Set.of("video", "usage", "orders").contains(kind)) {
                throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
            }
            return service.records(cookie(request), kind, query(request, "q", 80).strip(),
                    query(request, "state", 32), page(request));
        });
    }

    @GetMapping("/admin/audit")
    public void audit(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, () -> service.audit(cookie(request), page(request)));
    }

    @GetMapping("/admin/settings")
    public void settings(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, () -> service.settingsView(cookie(request)));
    }

    @PostMapping("/admin/settings/{key}")
    public void settingsChange(HttpServletRequest request, HttpServletResponse response, @PathVariable String key) throws IOException {
        run(request, response, true, () -> service.settingsChange(cookie(request), key,
                MigrationSupport.readJson(request, json, 4096, false)));
    }

    @GetMapping("/site/announcement")
    public void announcement(HttpServletResponse response) throws IOException {
        try {
            MigrationSupport.ok(response, json, service.announcement(), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    private interface Action { Object run(); }

    private void run(HttpServletRequest request, HttpServletResponse response, Action action) throws IOException {
        run(request, response, false, action);
    }

    private void run(HttpServletRequest request, HttpServletResponse response, boolean mutation, Action action) throws IOException {
        try {
            origin.require(request, mutation);
            service.authorize(cookie(request));
            MigrationSupport.ok(response, json, action.run(), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    private static String cookie(HttpServletRequest request) {
        return AccountReader.cookieHash(request.getHeader("Cookie"));
    }

    private static String query(HttpServletRequest request, String name, int maximum) {
        String value = request.getParameter(name);
        if (value == null) return "";
        if (value.length() > maximum) throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
        return value;
    }

    private static int page(HttpServletRequest request) {
        String value = request.getParameter("page");
        if (value == null) return 1;
        try {
            int page = Integer.parseInt(value);
            if (page < 1 || page > 100000) throw new NumberFormatException();
            return page;
        } catch (NumberFormatException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
        }
    }

    @SuppressWarnings("unused")
    private static Map<String, Object> unused() { return Map.of(); }
}
