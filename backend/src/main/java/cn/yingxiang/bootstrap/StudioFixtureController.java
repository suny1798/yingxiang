package cn.yingxiang.bootstrap;

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

@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.studio-fixture-enabled", havingValue = "true")
public class StudioFixtureController {
    private final StudioFixtureService service;
    private final JsonMapper json;
    public StudioFixtureController(StudioFixtureService service, JsonMapper json) { this.service = service; this.json = json; }

    @GetMapping("/studio/status")
    public void status(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try { write(request, response, service.status(), 200); }
        catch (RuntimeException error) { failure(request, response, error); }
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
            if (token) write(request, response, service.issue(hashed, body, request.getHeader("Origin")), 200);
            else { service.observe(userId, body); write(request, response, Map.of("accepted", true), 200); }
        } catch (RuntimeException error) { failure(request, response, error); }
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
    private void failure(HttpServletRequest request, HttpServletResponse response, RuntimeException error) throws IOException {
        BusinessFailure failure = error instanceof BusinessFailure expected ? expected : BusinessFailure.unavailable();
        write(request, response, Map.of("error", Map.of("code", failure.code, "message", failure.getMessage(), "retryable", false), "requestId", response.getHeader("X-Request-Id")), failure.status);
    }
    private void write(HttpServletRequest request, HttpServletResponse response, Object value, int status) throws IOException {
        byte[] bytes = json.writeValueAsBytes(value);
        response.setStatus(status); response.setContentType("application/json"); response.setContentLength(bytes.length);
        if (!request.getMethod().equals("HEAD")) response.getOutputStream().write(bytes);
    }
}
