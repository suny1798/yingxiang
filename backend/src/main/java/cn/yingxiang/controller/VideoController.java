package cn.yingxiang.controller;

import cn.yingxiang.config.MigrationOrigin;
import cn.yingxiang.service.VideoService;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.UploadGate;
import cn.yingxiang.manager.Multipart;
import cn.yingxiang.manager.Mp4;
import cn.yingxiang.mapper.MigrationAccounts;
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
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** M14视频任务入口：prepare不登录；任务提交／查询／下载要求本人会话与精确来源。 */
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
@ConditionalOnProperty(name = "migration.video-enabled", havingValue = "true")
public class VideoController {
    private static final int BODY_LIMIT = 35 * 1024 * 1024 + 4096;
    private final VideoService service;
    private final MigrationAccounts accounts;
    private final UploadGate uploadGate;
    private final MigrationOrigin origin;
    private final JsonMapper json;

    public VideoController(VideoService service, MigrationAccounts accounts, UploadGate uploadGate,
                           MigrationOrigin origin, JsonMapper json) {
        this.service = service; this.accounts = accounts; this.uploadGate = uploadGate;
        this.origin = origin; this.json = json;
    }

    @GetMapping("/video/jobs")
    public void status(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request, false);
            var user = accounts.optional(AccountReader.cookieHash(request.getHeader("Cookie")));
            MigrationSupport.ok(response, json, service.status(user == null ? null : user.id()), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/video/prepare")
    public void prepare(HttpServletRequest request, HttpServletResponse response) throws IOException {
        UploadGate.Lease slot = uploadGate.acquire("video", "api-" + MigrationSupport.uuid(), 130_000L);
        if (slot == null) {
            MigrationSupport.failure(response, json, new BusinessFailure("VIDEO_BUSY", "视频处理正忙，请稍后重试。", 503));
            return;
        }
        try {
            origin.require(request, true);
            String contentType = request.getContentType();
            if (contentType == null || !contentType.split(";", 2)[0].equals("video/mp4")) {
                throw new BusinessFailure("INVALID_VIDEO_UPLOAD", "请选择MP4视频。", 415);
            }
            service.prepareRateLimit();
            byte[] data = MigrationSupport.readBytes(request, 25 * 1024 * 1024,
                    "BODY_TOO_LARGE", "请求内容过大。");
            var prepared = service.prepare(data);
            response.setHeader("X-Video-Audio-Removed", prepared.removed() ? "1" : "0");
            response.setHeader("Content-Disposition", "inline; filename=\"prepared-video.mp4\"");
            response.setStatus(200);
            response.setContentType("video/mp4");
            response.setContentLength(prepared.bytes().length);
            response.getOutputStream().write(prepared.bytes());
        } catch (RuntimeException error) {
            MigrationSupport.failure(response, json, error);
        } finally {
            slot.close();
        }
    }

    @PostMapping("/video/jobs")
    public void submit(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request, true);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            String ident = request.getHeader("X-Video-Attempt");
            if (!MigrationSupport.isUuid(ident)) {
                throw new BusinessFailure("INVALID_VIDEO_ATTEMPT", "缺少有效的提交编号，请刷新后重试。", 400);
            }
            Map<String, Object> previous = service.previous(user.id(), ident);
            if (previous != null) {
                MigrationSupport.ok(response, json, previous, 200);
                return;
            }
            if (!service.configured()) {
                throw new BusinessFailure("VIDEO_DISABLED", "视频生成待开放，可先预览素材。", 503);
            }
            String contentType = request.getContentType();
            if (contentType == null || contentType.length() > 256 || !contentType.startsWith("multipart/form-data;")) {
                throw new BusinessFailure("INVALID_VIDEO_UPLOAD", "请通过页面选择视频与服装图。", 415);
            }
            UploadGate.Lease slot = uploadGate.acquire("video", "api-" + MigrationSupport.uuid(), 130_000L);
            if (slot == null) {
                throw new BusinessFailure("VIDEO_BUSY", "任务服务正忙，请稍后刷新。", 503);
            }
            try {
                byte[] data = MigrationSupport.readBytes(request, BODY_LIMIT, "VIDEO_TOO_LARGE", "上传内容过大。");
                var parts = Multipart.parse(data, contentType);
                Map<String, Multipart.Part> values = new java.util.LinkedHashMap<>();
                for (var part : parts) values.put(part.name(), part);
                var consent = values.get("consentVersion");
                var video = values.get("data");
                var image = values.get("reference_image");
                if (consent.hasFilename() || !new String(consent.body(), StandardCharsets.UTF_8).equals(VideoService.CONSENT)) {
                    throw new BusinessFailure("VIDEO_CONSENT_REQUIRED", "请重新确认视频云端处理说明。", 400);
                }
                if (!video.hasFilename() || !image.hasFilename() || !video.contentType().equals("video/mp4")
                        || image.body().length > 10 * 1024 * 1024) {
                    throw new BusinessFailure("INVALID_VIDEO_UPLOAD", "请选择MP4视频和不超过10MB的服装图。", 400);
                }
                var prepared = service.prepare(video.body());
                try {
                    Mp4.validateImage(image.body(), image.contentType());
                } catch (IllegalArgumentException error) {
                    throw new BusinessFailure("INVALID_VIDEO_MEDIA", error.getMessage(), 400);
                }
                MigrationSupport.ok(response, json,
                        service.submit(user.id(), ident, prepared.bytes(), image.body(), image.contentType(), prepared.seconds()), 200);
            } finally {
                slot.close();
            }
        } catch (RuntimeException error) {
            MigrationSupport.failure(response, json, error);
        }
    }

    @GetMapping("/video/jobs/{ident}")
    public void get(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        try {
            origin.require(request, false);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            MigrationSupport.ok(response, json, service.get(user.id(), ident), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @GetMapping("/video/history")
    public void history(HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            origin.require(request, false);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            boolean archived = "true".equals(request.getParameter("archived"));
            int page = integer(request, "page", 1, 1, 100_000);
            int size = integer(request, "pageSize", 3, 1, 12);
            MigrationSupport.ok(response, json, service.history(user.id(), archived, page, size), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @PostMapping("/video/jobs/{ident}/history")
    public void historyChange(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {
        try {
            origin.require(request, true);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            var body = MigrationSupport.readJson(request, json, 4096, true);
            MigrationSupport.ok(response, json, service.historyChange(user.id(), ident, body), 200);
        } catch (RuntimeException error) { MigrationSupport.failure(response, json, error); }
    }

    @GetMapping("/video/jobs/{ident}/content")
    public void content(HttpServletRequest request, HttpServletResponse response, @PathVariable String ident) throws IOException {        try {
            origin.require(request, false);
            var user = accounts.require(AccountReader.cookieHash(request.getHeader("Cookie")));
            var content = service.content(user.id(), ident);
            boolean download = "1".equals(request.getParameter("download"));
            response.setStatus(200);
            response.setContentType("video/mp4");
            if (content.length() > 0) response.setContentLengthLong(content.length());
            response.setHeader("Content-Disposition", (download ? "attachment" : "inline")
                    + "; filename=\"yingxiang-" + content.jobId() + ".mp4\"");
            response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
            try (InputStream stream = content.stream()) {
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = stream.read(buffer)) != -1) {
                    total += read;
                    if (total > 200L * 1024 * 1024) throw new IOException("视频结果过大。");
                    response.getOutputStream().write(buffer, 0, read);
                }
            }
        } catch (RuntimeException error) {
            if (!response.isCommitted()) MigrationSupport.failure(response, json, error);
        }
    }

    private static int integer(HttpServletRequest request, String name, int fallback, int minimum, int maximum) {
        String value = request.getParameter(name);
        if (value == null || value.isEmpty()) return fallback;
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
        }
    }
}
