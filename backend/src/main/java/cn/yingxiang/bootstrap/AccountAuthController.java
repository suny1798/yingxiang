package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Map;

@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
public class AccountAuthController {
    private final AccountAuthService service;
    private final JsonMapper json;
    private final boolean secure;
    public AccountAuthController(AccountAuthService service, JsonMapper json, Environment env) {
        this.service = service; this.json = json;
        secure = env.getRequiredProperty("migration.public-origin").startsWith("https:");
    }

    @PostMapping({"/account/register", "/account/login"})
    public void authenticate(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            String contentType = request.getContentType();
            if (contentType == null || !contentType.split(";", 2)[0].strip().equals("application/json")) {
                throw new BusinessFailure("INVALID_REQUEST", "请使用JSON请求。", 415);
            }
            byte[] bytes = request.getInputStream().readNBytes(4097);
            if (bytes.length > 4096) throw new BusinessFailure("BODY_TOO_LARGE", "请求内容过大。", 413);
            JsonNode body;
            try {
                String input = java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                        .decode(java.nio.ByteBuffer.wrap(bytes)).toString();
                body = json.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(input);
            } catch (RuntimeException | java.nio.charset.CharacterCodingException error) {
                throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400);
            }
            if (body == null || !body.isObject()) throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400);
            if (body.size() != 2 || !body.has("username") || !body.has("password") || !body.get("username").isString() || !body.get("password").isString()) {
                AccountAuthService.validate(null, null);
            }
            var result = service.authenticate(body.get("username").asString(), body.get("password").asString(), request.getRequestURI().endsWith("/register"));
            response.setHeader("Set-Cookie", "yingxiang_session=" + result.token + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800" + (secure ? "; Secure" : ""));
            write(response, result.view, 200);
        } catch (BusinessFailure error) { failure(request, response, error); }
        catch (RuntimeException error) { failure(request, response, BusinessFailure.unavailable()); }
    }

    @PostMapping("/account/logout")
    public void logout(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            service.logout(AccountReader.cookieHash(request.getHeader("Cookie")));
            response.setHeader("Set-Cookie", "yingxiang_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
            write(response, Map.of("accepted", true), 200);
        } catch (RuntimeException error) { failure(request, response, BusinessFailure.unavailable()); }
    }

    private void failure(HttpServletRequest request, HttpServletResponse response, BusinessFailure error) throws IOException {
        write(response, Map.of("error", Map.of("code", error.code, "message", error.getMessage(), "retryable", false),
                "requestId", response.getHeader("X-Request-Id")), error.status);
    }
    private void write(HttpServletResponse response, Object body, int status) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        response.setStatus(status); response.setContentType("application/json"); response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }
}
