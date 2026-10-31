package cn.yingxiang.controller;

import cn.yingxiang.common.BillingPolicy;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.config.MigrationOrigin;
import cn.yingxiang.mapper.AccountReader;
import cn.yingxiang.mapper.MigrationAccounts;
import cn.yingxiang.service.BillingService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;

@RestController
@Profile("local")
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class BillingController {
    private final BillingService billing;
    private final MigrationAccounts accounts;
    private final MigrationOrigin origin;
    private final JsonMapper json;
    public BillingController(BillingService billing, MigrationAccounts accounts, MigrationOrigin origin, JsonMapper json) {
        this.billing=billing; this.accounts=accounts; this.origin=origin; this.json=json;
    }
    @GetMapping("/billing/catalog")
    public void catalog(HttpServletResponse response) throws IOException {
        MigrationSupport.ok(response,json,BillingPolicy.CATALOG,200);
    }
    @GetMapping("/billing/wallet")
    public void wallet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request,false);
            var user=accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            MigrationSupport.ok(response,json,MigrationSupport.body("real",billing.view(user.id(),"real_usage"),
                    "sandbox",billing.view(user.id(),"stripe_sandbox")),200);
        } catch (RuntimeException error) { MigrationSupport.failure(response,json,error); }
    }
}
