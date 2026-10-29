package cn.yingxiang.controller;

import cn.yingxiang.config.MigrationOrigin;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.service.PromptService;
import cn.yingxiang.mapper.MigrationAccounts;
import cn.yingxiang.mapper.AccountReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;

/** M16实时编辑入口：状态公开；令牌要求本人会话、精确来源与编辑访问凭据。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.prompt-enabled", havingValue = "true")
public class PromptController {
    private final PromptService service;
    private final MigrationAccounts accounts;
    private final MigrationOrigin origin;
    private final JsonMapper json;

    public PromptController(PromptService service, MigrationAccounts accounts, MigrationOrigin origin, JsonMapper json) {
        this.service = service; this.accounts = accounts; this.origin = origin; this.json = json;
    }

    @GetMapping("/prompt/status")
    public void status(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request, false);
            var user = accounts.optional(AccountReader.cookieHash(request.getHeader("Cookie")));
            MigrationSupport.ok(response, json, service.status(user == null ? null : user.id()), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/prompt/token")
    public void token(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            String publicOrigin = origin.require(request, true);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            service.authenticate(request.getHeader("X-Studio-Access"));
            var body = MigrationSupport.readJson(request, json, 4096, true);
            MigrationSupport.ok(response, json,
                    service.issue(AccountReader.cookieHash(request.getHeader("Cookie")), body, publicOrigin), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }
}
