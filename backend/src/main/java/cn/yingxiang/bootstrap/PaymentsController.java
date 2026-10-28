package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;

/** M13-a路由；支付门禁先于来源/请求体检查，与旧入口顺序一致。 */
@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.payments-enabled", havingValue = "true")
public class PaymentsController {
    private final PaymentsService service;
    private final MigrationOrigin origin;
    private final JsonMapper json;

    public PaymentsController(PaymentsService service, MigrationOrigin origin, JsonMapper json) {
        this.service = service; this.origin = origin; this.json = json;
    }

    @GetMapping("/payments/status")
    public void status(HttpServletResponse response) throws IOException {
        MigrationSupport.write(response, json, service.status(), 200);
    }

    @GetMapping("/payments/orders")
    public void orders(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request, false);
            MigrationSupport.write(response, json, service.list(AccountReader.cookieHash(request.getHeader("Cookie"))), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/payments/checkout")
    public void checkout(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            service.requireEnabled();
            String publicOrigin = origin.require(request, true);
            var body = MigrationSupport.readJson(request, json, 4096, true);
            MigrationSupport.write(response, json,
                    service.checkout(AccountReader.cookieHash(request.getHeader("Cookie")), body, publicOrigin), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/payments/reconcile")
    public void reconcile(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            service.requireEnabled();
            var body = MigrationSupport.readJson(request, json, 4096, false);
            String publicOrigin = origin.require(request, true);
            MigrationSupport.write(response, json,
                    service.reconcile(AccountReader.cookieHash(request.getHeader("Cookie")), body, publicOrigin), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/payments/webhook")
    public void webhook(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            service.requireEnabled();
            String signature = request.getHeader("Stripe-Signature");
            if (signature == null) throw StripeGateway.invalidSignature();
            byte[] payload = request.getInputStream().readNBytes(262145);
            if (payload.length > 262144) throw new BusinessFailure("BODY_TOO_LARGE", "请求内容过大。", 413);
            MigrationSupport.write(response, json, service.webhook(payload, signature), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }
}
