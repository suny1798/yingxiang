package cn.yingxiang.controller;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.service.StudioFixtureService;
import cn.yingxiang.mapper.AccountReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@org.springframework.boot.autoconfigure.condition.ConditionalOnExpression("${migration.studio-fixture-enabled:false} or (${migration.runtime-enabled:false} and ${migration.studio-enabled:false})")
public class StudioFixtureController {
    private final StudioFixtureService service;
    private final JsonMapper json;
    public StudioFixtureController(StudioFixtureService service, JsonMapper json) { this.service = service; this.json = json; }

    @GetMapping("/studio/status")
    public void status(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try { MigrationSupport.ok(response, json, service.status()); }
        catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping({"/studio/token", "/studio/observation"})
    public void mutate(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            String hashed = AccountReader.cookieHash(request.getHeader("Cookie"));
            String userId = service.require(hashed);
            boolean token = request.getRequestURI().endsWith("/token");
            if (token) service.authenticate(request.getHeader("X-Studio-Access"));
            if (token) contentType(request);
            JsonNode body = read(request);
            if (!token) { service.authenticate(request.getHeader("X-Studio-Access")); contentType(request); }
            if (token) MigrationSupport.ok(response, json, service.issue(hashed, body, request.getHeader("Origin")));
            else { service.observe(userId, body); MigrationSupport.ok(response, json, Map.of("accepted", true)); }
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    private JsonNode read(HttpServletRequest request) {
        byte[] bytes;
        try { bytes = request.getInputStream().readNBytes(4097); }
        catch (IOException error) { throw BusinessFailure.unavailable(); }
        if (bytes.length > 4096) throw new BusinessFailure("BODY_TOO_LARGE", "请求内容过大。", 413);
        try {
            String input = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode body = json.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(input);
            if (body == null || !body.isObject()) throw new IllegalArgumentException();
            return body;
        } catch (RuntimeException | java.nio.charset.CharacterCodingException error) { throw new BusinessFailure("INVALID_REQUEST", "请求内容无法读取。", 400); }
    }
    private void contentType(HttpServletRequest request) {
        String value = request.getContentType();
        if (value == null || !value.split(";", 2)[0].strip().equals("application/json")) throw new BusinessFailure("INVALID_REQUEST", "请使用JSON请求。", 415);
    }
}
