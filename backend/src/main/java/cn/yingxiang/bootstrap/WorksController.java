package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** M15作品入口：本人会话＋精确来源＋可选X-Work-Owner绑定；文件支持Range。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.works-enabled", havingValue = "true")
public class WorksController {
    private static final int MAX_REFERENCE = 10 * 1024 * 1024;
    private final WorksService service;
    private final MigrationAccounts accounts;
    private final StoragePort storage;
    private final MigrationOrigin origin;
    private final JsonMapper json;

    public WorksController(WorksService service, MigrationAccounts accounts, StoragePort storage,
                           MigrationOrigin origin, JsonMapper json) {
        this.service = service; this.accounts = accounts; this.storage = storage; this.origin = origin; this.json = json;
    }

    @GetMapping("/works")
    public void list(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, false, false, (user, body) -> {
            String kind = query(request, "kind", 16, "all");
            if (!Set.of("all", "realtime", "video", "edit").contains(kind)) {
                throw new BusinessFailure("INVALID_WORK_KIND", "作品分类无效。", 400);
            }
            int page = number(request, "page", 1, 1, 100000);
            int size = number(request, "pageSize", 9, 1, 24);
            boolean favorite = "true".equals(query(request, "favorite", 8, "false"));
            return service.list(user, kind, page, size, query(request, "q", 240, ""), favorite,
                    query(request, "sort", 16, "newest"));
        });
    }

    @PostMapping("/works")
    public void create(HttpServletRequest request, HttpServletResponse response) throws IOException {
        run(request, response, true, true, (user, body) -> {
            JsonNode value = MigrationSupport.readJson(request, json, 4096, true);
            String ident = value.get("id") instanceof JsonNode id && id.isString() ? id.asString() : "invalid";
            synchronized (service.lock(ident)) {
                return service.view(service.create(user, value));
            }
        }, 201);
    }

    @PostMapping("/works/{ident}/chunks/{index}")
    public void chunk(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident,
                      @PathVariable String index) throws IOException {
        run(request, response, true, true, (user, body) -> {
            service.own(user, ident, false);
            byte[] data = MigrationSupport.readBytes(request, (int) WorksService.MAX_REALTIME, "BODY_TOO_LARGE", "请求内容过大。");
            synchronized (service.lock(ident)) {
                service.chunk(user, ident, parseIndex(index), data);
            }
            return Map.of("accepted", true);
        });
    }

    @PostMapping("/works/{ident}/complete")
    public void complete(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, true, true, (user, body) -> {
            JsonNode value = MigrationSupport.readJson(request, json, 4096, true);
            Set<String> fields = new java.util.LinkedHashSet<>();
            value.propertyNames().forEach(fields::add);
            if (!Set.of("referenceFailed", "promptsFailed", "durationMs", "interrupted").containsAll(fields)) {
                throw new BusinessFailure("INVALID_WORK", "保存参数无效。", 400);
            }
            for (String key : List.of("referenceFailed", "promptsFailed", "interrupted")) {
                JsonNode item = value.get(key);
                if (item != null && !item.isBoolean()) throw new BusinessFailure("INVALID_WORK", "保存参数无效。", 400);
            }
            Integer duration = null;
            JsonNode durationNode = value.get("durationMs");
            if (durationNode != null && !durationNode.isNull()) {
                if (!durationNode.isIntegralNumber() || durationNode.asLong() < 0 || durationNode.asLong() > 60_000) {
                    throw new BusinessFailure("INVALID_WORK", "保存时长无效。", 400);
                }
                duration = durationNode.asInt();
            }
            synchronized (service.lock(ident)) {
                service.complete(user, ident, duration,
                        value.path("interrupted").asBoolean(false), value.path("referenceFailed").asBoolean(false),
                        value.path("promptsFailed").asBoolean(false));
            }
            return Map.of("accepted", true);
        }, 202);
    }

    @GetMapping("/works/{ident}")
    public void get(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, false, false, (user, body) -> service.view(service.own(user, ident, false)));
    }

    @PostMapping("/works/{ident}")
    public void change(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, true, false, (user, body) -> {
            JsonNode value = MigrationSupport.readJson(request, json, 4096, true);
            synchronized (service.lock(ident)) {
                return service.change(user, ident, value);
            }
        });
    }

    @PostMapping("/works/{ident}/references/{refId}")
    public void reference(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident,
                          @PathVariable String refId) throws IOException {
        run(request, response, true, true, (user, body) -> {
            service.own(user, ident, false);
            byte[] data = MigrationSupport.readBytes(request, MAX_REFERENCE, "BODY_TOO_LARGE", "请求内容过大。");
            String mime = request.getContentType() == null ? "" : request.getContentType().split(";", 2)[0];
            synchronized (service.lock(ident)) {
                service.reference(user, ident, refId, mime, data);
            }
            return Map.of("accepted", true);
        });
    }

    @GetMapping("/works/{ident}/content")
    public void content(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        try {
            String user = authenticate(request, false, false);
            var work = service.own(user, ident, false);
            if (!work.state().equals("ready")) {
                throw new BusinessFailure("WORK_NOT_READY", "作品尚未保存完成。", 409);
            }
            Path path = storage.directory(user, ident).resolve("result." + work.extension());
            if (!storage.exists(path)) throw new BusinessFailure("WORK_FILE_MISSING", "作品文件暂不可用。", 404);
            serve(request, response, path, work.mime(), work.title() + "." + work.extension(),
                    "1".equals(request.getParameter("download")), true);
        } catch (RuntimeException error) {
            if (!response.isCommitted()) MigrationSupport.failure(response, json, error);
        }
    }

    @GetMapping("/works/{ident}/references/{refId}")
    public void referenceContent(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident,
                                 @PathVariable String refId) throws IOException {
        try {
            String user = authenticate(request, false, false);
            service.own(user, ident, false);
            var ref = service.references(ident).stream().filter(item -> refId.equals(item.get("id"))).findFirst().orElse(null);
            if (ref == null) throw new BusinessFailure("REFERENCE_NOT_FOUND", "找不到这张参考图。", 404);
            Path path = storage.directory(user, ident).resolve("reference-" + refId + "." + ref.get("extension"));
            if (!storage.exists(path)) throw new BusinessFailure("REFERENCE_NOT_FOUND", "找不到这张参考图。", 404);
            serve(request, response, path, (String) ref.get("mime"), null, false, false);
        } catch (RuntimeException error) {
            if (!response.isCommitted()) MigrationSupport.failure(response, json, error);
        }
    }

    @GetMapping("/works/{ident}/prompts")
    public void prompts(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        run(request, response, false, false, (user, body) -> Map.of("states", service.promptHistory(user, ident)));
    }

    @PostMapping("/works/{ident}/prompts/{index}")
    public void promptState(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident,
                            @PathVariable String index) throws IOException {
        run(request, response, true, true, (user, body) -> {
            service.own(user, ident, false);
            String contentType = request.getContentType();
            if (contentType == null || !contentType.split(";", 2)[0].strip().equals("application/json")) {
                throw new BusinessFailure("INVALID_REQUEST", "请使用JSON请求。", 415);
            }
            byte[] data = MigrationSupport.readBytes(request, 32 * 1024, "BODY_TOO_LARGE", "请求内容过大。");
            JsonNode value;
            try {
                value = json.readTree(new String(data, StandardCharsets.UTF_8));
            } catch (RuntimeException error) {
                throw new BusinessFailure("INVALID_WORK_PROMPTS", "提示词记录格式无效。", 400);
            }
            synchronized (service.lock(ident)) {
                service.promptState(user, ident, parseIndex(index), value);
            }
            return Map.of("accepted", true);
        });
    }

    private interface Action { Object run(String user, JsonNode body); }

    private void run(HttpServletRequest request, HttpServletResponse response, boolean mutation, boolean bound, Action action)
            throws IOException {
        run(request, response, mutation, bound, action, 200);
    }

    private void run(HttpServletRequest request, HttpServletResponse response, boolean mutation, boolean bound,
                     Action action, int status) throws IOException {
        try {
            String user = authenticate(request, mutation, bound);
            MigrationSupport.write(response, json, action.run(user, null), status);
        } catch (RuntimeException error) {
            MigrationSupport.failure(response, json, error);
        }
    }

    private String authenticate(HttpServletRequest request, boolean mutation, boolean bound) {
        origin.require(request, mutation);
        String user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie"))).id();
        String header = request.getHeader("X-Work-Owner");
        if (bound && !user.equals(header)) {
            throw new BusinessFailure("WORK_OWNER_CHANGED", "账号已变更，已停止原账号的上传。", 409);
        }
        if (!bound && header != null && !user.equals(header)) {
            throw new BusinessFailure("WORK_OWNER_CHANGED", "账号已变更，已停止原账号的上传。", 409);
        }
        return user;
    }

    private static int parseIndex(String value) {
        try {
            int index = Integer.parseInt(value);
            if (index < 0 || index > 100000) throw new NumberFormatException();
            return index;
        } catch (NumberFormatException error) {
            throw new BusinessFailure("INVALID_CHUNK", "录像片段无效。", 400);
        }
    }

    private static String query(HttpServletRequest request, String name, int maximum, String fallback) {
        String value = request.getParameter(name);
        if (value == null) return fallback;
        if (value.length() > maximum) throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
        return value;
    }

    private static int number(HttpServletRequest request, String name, int fallback, int minimum, int maximum) {
        String value = request.getParameter(name);
        if (value == null) return fallback;
        try {
            int number = Integer.parseInt(value);
            if (number < minimum || number > maximum) throw new NumberFormatException();
            return number;
        } catch (NumberFormatException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
        }
    }

    private void serve(HttpServletRequest request, HttpServletResponse response, Path path, String mime,
                       String filename, boolean attachment, boolean range) throws IOException {
        long size = Files.size(path);
        long start = 0, end = size - 1;
        boolean partial = false;
        String header = request.getHeader("Range");
        if (range && header != null) {
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("^bytes=([0-9]*)-([0-9]*)$").matcher(header.strip());
            if (!matcher.matches() || (matcher.group(1).isEmpty() && matcher.group(2).isEmpty())) {
                response.setStatus(416);
                response.setHeader("Content-Range", "bytes */" + size);
                return;
            }
            start = matcher.group(1).isEmpty() ? 0 : Long.parseLong(matcher.group(1));
            end = matcher.group(2).isEmpty() ? size - 1 : Long.parseLong(matcher.group(2));
            if (start > end || start >= size) {
                response.setStatus(416);
                response.setHeader("Content-Range", "bytes */" + size);
                return;
            }
            end = Math.min(end, size - 1);
            partial = true;
        }
        long length = end - start + 1;
        response.setStatus(partial ? 206 : 200);
        response.setContentType(mime);
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        if (partial) response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
        response.setContentLengthLong(length);
        if (filename != null) {
            String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
            response.setHeader("Content-Disposition", (attachment ? "attachment" : "inline") + "; filename*=UTF-8''" + encoded);
        }
        try (var stream = Files.newInputStream(path)) {
            stream.skipNBytes(start);
            byte[] buffer = new byte[64 * 1024];
            long remaining = length;
            while (remaining > 0) {
                int read = stream.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) break;
                response.getOutputStream().write(buffer, 0, read);
                remaining -= read;
            }
        }
    }
}
