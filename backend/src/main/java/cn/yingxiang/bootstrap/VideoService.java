package cn.yingxiang.bootstrap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** M14：已有视频任务的内存校验、预算预留、替身上游提交与查询；unknown不重POST。 */
@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.video-enabled", havingValue = "true")
public class VideoService {
    static final String MODEL = "lucy-vton-3.6";
    static final String CONSENT = "2026-10-26-video-save-v1";
    static final String PROMPT = "Dress the person in the garment from the reference image. "
            + "Preserve the person, face, body, pose, background and lighting.";
    static final long RESULT_WINDOW_MS = 86_400_000L;
    static final long USD_PER_SECOND_MICRO = 40_000L;
    private static final Set<String> STATES = Set.of("pending", "processing", "completed", "failed");

    record Job(String id, String userId, String state, long createdAt, long expiresAt, long secondsMilli,
               long microUsd, String providerId, Long checkedAt) {}

    private final JdbcTemplate jdbc;
    private final MigrationAccounts accounts;
    private final RateLimitService rateLimit;
    private final JsonMapper json;
    private final TransactionTemplate transaction;
    private final String schema;
    private final Environment env;
    private final boolean enabledFlag;
    private final long budgetMicro;
    private final int maximum;
    private final Set<String> allowedUsers;
    private final String providerBase;
    private final String key;
    private final HttpClient client;
    private final AtomicBoolean busy = new AtomicBoolean();

    public VideoService(JdbcTemplate jdbc, MigrationAccounts accounts, RateLimitService rateLimit,
                        PlatformTransactionManager manager, Environment env, JsonMapper json) {
        this.jdbc = jdbc; this.accounts = accounts; this.rateLimit = rateLimit; this.env = env; this.json = json;
        this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M14 video");
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(10);
        enabledFlag = Boolean.parseBoolean(env.getProperty("migration.video-enabled", "false"));
        double budget;
        double max;
        try {
            budget = Double.parseDouble(env.getProperty("migration.video-budget-usd", "0"));
            max = Double.parseDouble(env.getProperty("migration.video-max-jobs", "0"));
        } catch (NumberFormatException error) {
            budget = max = 0;
        }
        budgetMicro = Double.isFinite(budget) ? Math.round(budget * 1_000_000) : 0;
        maximum = Double.isFinite(max) && max == Math.floor(max) && max > 0 && max <= 20 ? (int) max : 0;
        allowedUsers = new LinkedHashSet<>(Arrays.stream(env.getProperty("migration.video-allowed-usernames", "").split(","))
                .map(String::strip).filter(value -> !value.isEmpty()).toList());
        if (RuntimePolicy.runtime(env) && allowedUsers.isEmpty()) throw new IllegalStateException("Runtime video whitelist required");
        key = env.getProperty("migration.video-key", "").strip();
        providerBase = env.getProperty("migration.video-provider-url", "").replaceAll("/+$", "");
        if (RuntimePolicy.runtime(env)) RuntimePolicy.tokenKey(key, true);
        URI uri = URI.create(providerBase.isEmpty() ? "http://127.0.0.1:1" : providerBase);
        RuntimePolicy.endpoint(uri, "api.decart.ai", "", RuntimePolicy.runtime(env));
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    public boolean configured() {
        return enabledFlag && budgetMicro > 0 && budgetMicro <= 5_000_000 && maximum > 0 && !key.isEmpty();
    }

    public long budgetMicro() { return budgetMicro; }
    public int maximum() { return maximum; }
    public boolean allowed(String userId) {
        if (allowedUsers.isEmpty()) return true;
        var user = accounts.byId(userId);
        return user != null && allowedUsers.contains(user.username());
    }

    private boolean paused() {
        var rows = jdbc.queryForList("SELECT value FROM " + schema + "admin_settings WHERE key='services'");
        if (rows.isEmpty()) return false;
        try {
            JsonNode settings = json.readTree((String) rows.getFirst().get("value"));
            JsonNode video = settings.get("video");
            return video != null && video.isBoolean() && video.asBoolean();
        } catch (RuntimeException error) {
            throw BusinessFailure.unavailable();
        }
    }

    public Map<String, Object> status(String userId) {
        boolean enabled = configured() && !paused();
        List<Job> rows = allJobs();
        boolean active = rows.stream().anyMatch(job -> !Set.of("completed", "failed").contains(job.state()));
        long remaining = budgetMicro - rows.stream().mapToLong(Job::microUsd).sum();
        Set<String> archived = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT job_id FROM " + schema + "video_history WHERE archived=1", String.class));
        boolean allowed = userId == null ? allowedUsers.isEmpty() : allowed(userId);
        boolean available = allowed && enabled && remaining >= USD_PER_SECOND_MICRO && rows.size() < maximum && !active;
        String message;
        if (enabled && !allowed) message = "视频换装目前仅向指定测试账号开放。";
        else if (!enabled) message = "视频生成待开放，可先预览素材。";
        else if (active) message = "有任务正在处理或待核查，请先查看任务。";
        else if (!available) message = "本轮视频额度已用完，请联系开发者。";
        else message = "本轮视频生成已开放。";
        List<Map<String, Object>> jobs = new ArrayList<>();
        List<Job> own = rows.stream().filter(job -> job.userId().equals(userId) && !archived.contains(job.id())).toList();
        List<Job> tail = own.subList(Math.max(0, own.size() - 20), own.size());
        for (int index = tail.size() - 1; index >= 0; index--) jobs.add(view(tail.get(index)));
        return MigrationSupport.body("available", available, "message", message, "jobs", jobs);
    }

    public Map<String, Object> previous(String userId, String ident) {
        Job job = find(ident);
        if (job == null) return null;
        if (!job.userId().equals(userId)) throw new BusinessFailure("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404);
        return view(job);
    }

    public Map<String, Object> history(String userId, boolean archived, int page, int size) {
        int total = count("SELECT count(*) FROM " + schema + "video_jobs j LEFT JOIN " + schema
                + "video_history h ON h.job_id=j.id WHERE j.user_id=? AND coalesce(h.archived,0)=?",
                userId, archived ? 1 : 0);
        int pages = Math.max(1, (total + size - 1) / size);
        int actual = Math.min(Math.max(1, page), pages);
        List<Map<String, Object>> items = new ArrayList<>();
        for (var row : jdbc.queryForList("SELECT j.*,h.title,h.archived FROM " + schema + "video_jobs j LEFT JOIN "
                + schema + "video_history h ON h.job_id=j.id WHERE j.user_id=? AND coalesce(h.archived,0)=? "
                + "ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?", userId, archived ? 1 : 0, size,
                (actual - 1) * size)) {
            Job job = job(row);
            items.add(historyView(job, (String) row.get("title"), MigrationSupport.number(row, "archived") == 1));
        }
        return MigrationSupport.body("items", items, "page", actual, "pageSize", size, "pages", pages, "total", total);
    }

    public Map<String, Object> historyChange(String userId, String ident, JsonNode body) {
        Set<String> fields = new java.util.LinkedHashSet<>();
        body.propertyNames().forEach(fields::add);
        if (fields.isEmpty() || !Set.of("title", "archived").containsAll(fields)) {
            throw new BusinessFailure("INVALID_VIDEO_HISTORY", "请填写视频名称或选择归档操作。", 400);
        }
        JsonNode titleNode = body.get("title");
        if (titleNode != null && (!titleNode.isString() || titleNode.asString().strip().length() < 1
                || titleNode.asString().strip().length() > 60
                || titleNode.asString().chars().anyMatch(value -> value < 32))) {
            throw new BusinessFailure("INVALID_VIDEO_TITLE", "视频名称需为1—60个字符，不能含换行。", 400);
        }
        JsonNode archivedNode = body.get("archived");
        if (archivedNode != null && !archivedNode.isBoolean()) {
            throw new BusinessFailure("INVALID_VIDEO_HISTORY", "归档状态无效，请刷新后重试。", 400);
        }
        Job job = own(userId, ident);
        if (archivedNode != null && archivedNode.asBoolean() && !Set.of("completed", "failed").contains(job.state())) {
            throw new BusinessFailure("VIDEO_HISTORY_ACTIVE", "任务完成或失败后才可归档，待核查任务请先确认状态。", 409);
        }
        var previous = jdbc.queryForList("SELECT title,archived FROM " + schema + "video_history WHERE job_id=?", ident);
        String title = titleNode != null ? titleNode.asString().strip()
                : previous.isEmpty() ? "视频换装" : (String) previous.getFirst().get("title");
        boolean archived = archivedNode != null ? archivedNode.asBoolean()
                : !previous.isEmpty() && MigrationSupport.number(previous.getFirst(), "archived") == 1;
        long now = System.currentTimeMillis();
        jdbc.update("INSERT INTO " + schema + "video_history(job_id,title,archived,updated_at) VALUES (?,?,?,?) "
                        + "ON CONFLICT (job_id) DO UPDATE SET title=excluded.title,archived=excluded.archived,"
                        + "updated_at=excluded.updated_at",
                ident, title, archived ? 1 : 0, now);
        return historyView(job, title, archived);
    }

    public Map<String, Object> submit(String userId, String ident, byte[] video, byte[] image, String mime, double seconds) {
        Reservation reservation = reserve(userId, ident, seconds);
        if (!reservation.fresh()) return view(reservation.job());
        try {
            Map<String, Object> value = createJob(video, image, mime);
            if (value != null) bind(ident, value);
        } catch (RuntimeException error) {
            // 已持久化unknown；不重试生成POST。
        }
        return view(own(userId, ident));
    }

    public Map<String, Object> get(String userId, String ident) {
        Poll poll = preparePoll(userId, ident);
        if (poll.check()) {
            try {
                Map<String, Object> value = pollJob(poll.job().providerId());
                if (!poll.job().providerId().equals(value.get("job_id")) || !(value.get("status") instanceof String status)
                        || !STATES.contains(status)) throw new IllegalStateException();
                applyPoll(ident, (String) value.get("status"));
            } catch (RuntimeException error) {
                throw new BusinessFailure("VIDEO_STATUS_UNAVAILABLE", "暂时无法更新进度，稍后可刷新任务；请勿重复提交。", 502);
            }
        }
        return view(own(userId, ident));
    }

    public Content content(String userId, String ident) {
        Job job = own(userId, ident);
        if (System.currentTimeMillis() >= job.expiresAt()) {
            throw new BusinessFailure("VIDEO_EXPIRED", "视频访问窗口已结束。", 410);
        }
        if (!"completed".equals(job.state()) || job.providerId() == null) {
            throw new BusinessFailure("VIDEO_NOT_READY", "视频尚未生成完成。", 409);
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(providerBase + "/v1/jobs/" + job.providerId() + "/content"))
                    .timeout(Duration.ofSeconds(120)).header("X-API-KEY", key).GET().build();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            String type = response.headers().firstValue("content-type").orElse("").split(";")[0].strip();
            long length = response.headers().firstValueAsLong("content-length").orElse(0);
            if (response.statusCode() < 200 || response.statusCode() > 299
                    || !Set.of("video/mp4", "application/octet-stream").contains(type) || length > 200L * 1024 * 1024) {
                response.body().close();
                throw new IllegalStateException();
            }
            return new Content(response.body(), length, job.id());
        } catch (BusinessFailure error) {
            throw error;
        } catch (Exception error) {
            throw new BusinessFailure("VIDEO_DOWNLOAD_UNAVAILABLE", "视频暂时无法下载，请稍后再试。", 502);
        }
    }

    public record Content(InputStream stream, long length, String jobId) {}

    /** prepare端点的内存槽：同一进程同一时间只处理一个上传。 */
    public boolean enterUpload() { return busy.compareAndSet(false, true); }
    public void leaveUpload() { busy.set(false); }

    public void prepareRateLimit() {
        rateLimit.check("video-prepare:global", 30, 10 * 60_000L);
    }

    public Prepared prepare(byte[] data) {
        try {
            var prepared = Mp4.prepare(data);
            return new Prepared(prepared.bytes(), prepared.info().seconds(), prepared.removed());
        } catch (IllegalArgumentException error) {
            throw new BusinessFailure("INVALID_VIDEO_MEDIA", "视频未能自动处理，请确认是1—15秒的普通H.264 MP4后重试。", 400);
        }
    }

    public record Prepared(byte[] bytes, double seconds, boolean removed) {}

    private record Reservation(Job job, boolean fresh) {}
    private record Poll(Job job, boolean check) {}

    private Reservation reserve(String userId, String ident, double seconds) {
        long estimate = (long) Math.ceil(seconds) * USD_PER_SECOND_MICRO;
        return transaction.execute(status -> {
            var rows = jdbc.queryForList("SELECT id,disabled FROM " + schema + "users WHERE id=?", userId);
            if (rows.isEmpty() || MigrationSupport.number(rows.getFirst(), "disabled") != 0) {
                throw new BusinessFailure("LOGIN_REQUIRED", "请先登录后继续。", 401);
            }
            if (paused() || !configured() || !allowed(userId)) {
                throw new BusinessFailure("VIDEO_DISABLED", "视频换装目前仅向指定测试账号开放。", 503);
            }
            Job existing = find(ident);
            if (existing != null) {
                if (!existing.userId().equals(userId)) throw new BusinessFailure("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404);
                return new Reservation(existing, false);
            }
            jdbc.update("INSERT INTO " + schema + "budget_campaigns(scene,created_at) VALUES ('video',?) ON CONFLICT (scene) DO NOTHING",
                    System.currentTimeMillis());
            // 串行化同一场景的预算预留，避免两进程同时通过上限检查。
            jdbc.queryForList("SELECT scene FROM " + schema + "budget_campaigns WHERE scene='video' FOR UPDATE");
            List<Job> jobs = allJobs();
            if (jobs.stream().anyMatch(job -> !Set.of("completed", "failed").contains(job.state()))) {
                throw new BusinessFailure("VIDEO_IN_PROGRESS", "请等待现有任务完成或核查，不要重复提交。", 409);
            }
            long used = jobs.stream().mapToLong(Job::microUsd).sum();
            if (jobs.size() >= maximum || used + estimate > budgetMicro) {
                throw new BusinessFailure("VIDEO_BUDGET_LIMIT", "本轮视频额度不足，请联系开发者。", 409);
            }
            long now = System.currentTimeMillis();
            Job job = new Job(ident, userId, "unknown", now, now + RESULT_WINDOW_MS,
                    (long) Math.ceil(seconds * 1000), estimate, null, null);
            jdbc.update("INSERT INTO " + schema + "video_jobs(id,user_id,state,created_at,expires_at,seconds_milli,micro_usd) "
                    + "VALUES (?,?,?,?,?,?,?)", job.id(), job.userId(), job.state(), job.createdAt(), job.expiresAt(),
                    job.secondsMilli(), job.microUsd());
            jdbc.update("INSERT INTO " + schema + "budget_reservations(id,scene,user_id,micro_usd,lease_until,created_at) "
                    + "VALUES (?,?,?,?,?,?)", ident, "video", userId, estimate, job.expiresAt(), now);
            return new Reservation(job, true);
        });
    }

    private Poll preparePoll(String userId, String ident) {
        return transaction.execute(status -> {
            Job job = own(userId, ident);
            long now = System.currentTimeMillis();
            boolean check = job.providerId() != null && Set.of("pending", "processing").contains(job.state())
                    && now < job.expiresAt() && now - (job.checkedAt() == null ? 0 : job.checkedAt()) >= 3000;
            if (check) jdbc.update("UPDATE " + schema + "video_jobs SET checked_at=? WHERE id=?", now, ident);
            return new Poll(job, check);
        });
    }

    private void applyPoll(String ident, String state) {
        transaction.executeWithoutResult(status -> {
            Job job = find(ident);
            if (job == null) throw BusinessFailure.unavailable();
            if (Set.of("pending", "processing").contains(job.state())
                    && !(job.state().equals("processing") && state.equals("pending"))) {
                jdbc.update("UPDATE " + schema + "video_jobs SET state=? WHERE id=?", state, ident);
            }
        });
    }

    private void bind(String ident, Map<String, Object> value) {
        transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                + "video_jobs SET provider_id=?,state=? WHERE id=?", value.get("job_id"), value.get("status"), ident));
    }

    private Job own(String userId, String ident) {
        Job job = find(ident);
        if (job == null || !job.userId().equals(userId)) throw new BusinessFailure("VIDEO_NOT_FOUND", "找不到这个视频任务。", 404);
        return job;
    }

    private List<Job> allJobs() {
        List<Job> jobs = new ArrayList<>();
        for (var row : jdbc.queryForList("SELECT * FROM " + schema + "video_jobs ORDER BY created_at,id")) jobs.add(job(row));
        return jobs;
    }

    private Job find(String ident) {
        var rows = jdbc.queryForList("SELECT * FROM " + schema + "video_jobs WHERE id=?", ident);
        return rows.isEmpty() ? null : job(rows.getFirst());
    }

    private static Job job(Map<String, Object> row) {
        return new Job((String) row.get("id"), (String) row.get("user_id"), (String) row.get("state"),
                MigrationSupport.number(row, "created_at"), MigrationSupport.number(row, "expires_at"),
                MigrationSupport.number(row, "seconds_milli"), MigrationSupport.number(row, "micro_usd"),
                (String) row.get("provider_id"), row.get("checked_at") instanceof Number number ? number.longValue() : null);
    }

    private static Map<String, Object> view(Job job) {
        long now = System.currentTimeMillis();
        return MigrationSupport.body("id", job.id(), "state", job.state(),
                "createdAt", MigrationSupport.iso(job.createdAt()), "expiresAt", MigrationSupport.iso(job.expiresAt()),
                "seconds", job.secondsMilli() / 1000.0, "estimateUsd", job.microUsd() / 1_000_000.0,
                "expired", now >= job.expiresAt());
    }

    private static Map<String, Object> historyView(Job job, String title, boolean archived) {
        Map<String, Object> value = new java.util.LinkedHashMap<>(view(job));
        value.put("title", title == null || title.isBlank() ? "视频换装" : title);
        value.put("archived", archived);
        return value;
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    private Map<String, Object> createJob(byte[] video, byte[] image, String mime) {
        String extension = Map.of("image/jpeg", "jpg", "image/png", "png", "image/webp", "webp").get(mime);
        String boundary = "----yingxiang" + MigrationSupport.uuid().replace("-", "");
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        writePart(body, boundary, "prompt", null, null, PROMPT.getBytes(StandardCharsets.UTF_8));
        writePart(body, boundary, "resolution", null, null, "720p".getBytes(StandardCharsets.UTF_8));
        writePart(body, boundary, "enhance_prompt", null, null, "false".getBytes(StandardCharsets.UTF_8));
        writePart(body, boundary, "data", "person.mp4", "video/mp4", video);
        writePart(body, boundary, "reference_image", "garment." + extension, mime, image);
        body.writeBytes(("--" + boundary + "--\r\n").getBytes(StandardCharsets.ISO_8859_1));
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(providerBase + "/v1/jobs/" + MODEL))
                    .timeout(Duration.ofSeconds(60)).header("X-API-KEY", key)
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() > 299 || response.body().length > 8192) return null;
            JsonNode value = json.readTree(new String(response.body(), StandardCharsets.UTF_8));
            if (value == null || !value.isObject()) return null;
            JsonNode id = value.get("job_id"), status = value.get("status");
            if (id == null || !id.isString() || !id.asString().matches("[a-zA-Z0-9_-]{1,128}")
                    || status == null || !status.isString() || !STATES.contains(status.asString())) return null;
            return Map.of("job_id", id.asString(), "status", status.asString());
        } catch (Exception error) {
            return null;
        }
    }

    private Map<String, Object> pollJob(String providerId) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(providerBase + "/v1/jobs/" + providerId))
                    .timeout(Duration.ofSeconds(15)).header("X-API-KEY", key).GET().build();
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() > 299 || response.body().length > 8192) throw new IllegalStateException();
            JsonNode value = json.readTree(new String(response.body(), StandardCharsets.UTF_8));
            if (value == null || !value.isObject()) throw new IllegalStateException();
            return Map.of("job_id", value.path("job_id").asString(""), "status", value.path("status").asString(""));
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException();
        }
    }

    private static void writePart(ByteArrayOutputStream output, String boundary, String name, String filename,
                                  String contentType, byte[] value) {
        StringBuilder header = new StringBuilder("--" + boundary + "\r\n")
                .append("Content-Disposition: form-data; name=\"").append(name).append('"');
        if (filename != null) header.append("; filename=\"").append(filename).append('"');
        header.append("\r\n");
        if (contentType != null) header.append("Content-Type: ").append(contentType).append("\r\n");
        header.append("\r\n");
        output.writeBytes(header.toString().getBytes(StandardCharsets.ISO_8859_1));
        output.writeBytes(value);
        output.writeBytes("\r\n".getBytes(StandardCharsets.ISO_8859_1));
    }
}
