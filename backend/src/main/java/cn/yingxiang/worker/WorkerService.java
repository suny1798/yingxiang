package cn.yingxiang.worker;

import cn.yingxiang.manager.StoragePort;
import cn.yingxiang.mapper.WorkerMapper;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.manager.Mp4;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.EnvironmentAware;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * M17／M18：独立Worker只认领已存在的视频任务和已确认分片。
 * 不提交生成POST；下载使用租约代次临时文件，发布前再次核对租约与作品状态。
 */
@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.worker-enabled", havingValue = "true")
public class WorkerService implements SmartLifecycle, EnvironmentAware {
    public static final String VIDEO_SAVE = "video-save";
    public static final String CAPTURE_FINISH = "capture-finish";
    public static final String CLEANUP = "cleanup";
    private static final Set<String> ACTIVE_JOB = Set.of("pending", "processing");
    private static final long MAX_RESULT = 200L * 1024 * 1024;

    public record Task(String id, String type, String userId, String resourceId, String dedupeKey, String state,
                int attempts, int maxAttempts, long generation) {}
    public record Work(String id, String userId, String kind, String sourceId, String state, String extension,
                long bytes, int chunks, int retries, String errorCode) {}
    public record Job(String id, String state, String providerId, long expiresAt) {}

    private final JdbcTemplate jdbc;
    private final WorkerMapper workers;
    private final StoragePort storage;
    private final JsonMapper json;
    private final TransactionTemplate transaction;
    private final String schema;
    private final String workerId;
    private final long leaseMs;
    private final long retryMs;
    private final long captureTimeoutMs;
    private final long pollMs;
    private final int batch;
    private final int maxAttempts;
    private final String providerBase;
    private final String key;
    private final HttpClient client;
    private final AtomicBoolean running = new AtomicBoolean();
    private Environment environment;
    private Thread thread;

    public WorkerService(JdbcTemplate jdbc, WorkerMapper workers, StoragePort storage, PlatformTransactionManager manager,
                         Environment env, JsonMapper json) {
        this.jdbc = jdbc; this.workers = workers; this.storage = storage; this.environment = env; this.json = json;
        this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M17 worker");
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(20);
        String configuredId = env.getProperty("migration.worker-id", "").strip();
        workerId = configuredId.isEmpty() ? "worker-" + MigrationSupport.uuid().substring(0, 8) : configuredId;
        leaseMs = positive(env, "migration.worker-lease-ms", 60_000L);
        retryMs = positive(env, "migration.worker-retry-ms", 2_000L);
        captureTimeoutMs = positive(env, "migration.worker-capture-timeout-ms", 120_000L);
        pollMs = positive(env, "migration.worker-poll-ms", 500L);
        batch = (int) Math.min(32, positive(env, "migration.worker-batch", 8L));
        maxAttempts = (int) Math.min(10, positive(env, "migration.worker-max-attempts", 3L));
        key = env.getProperty("migration.video-key", "").strip();
        providerBase = env.getProperty("migration.video-provider-url", "").replaceAll("/+$", "");
        if (RuntimePolicy.runtime(env)) RuntimePolicy.tokenKey(key, true);
        URI uri = URI.create(providerBase.isEmpty() ? "http://127.0.0.1:1" : providerBase);
        RuntimePolicy.endpoint(uri, "api.decart.ai", "", RuntimePolicy.runtime(env));
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    private static long positive(Environment env, String name, long fallback) {
        try {
            long value = Long.parseLong(env.getProperty(name, Long.toString(fallback)));
            return value > 0 ? value : fallback;
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    @Override public void setEnvironment(Environment environment) { this.environment = environment; }
    public String workerId() { return workerId; }

    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void ready() { System.out.println("YINGXIANG_WORKER_READY"); }

    @Override public void start() {
        if (!"worker".equals(environment.getProperty("migration.role", "api")))
            throw new IllegalStateException("Worker role required");
        if (!running.compareAndSet(false, true)) return;
        thread = new Thread(this::loop, "yingxiang-worker-" + workerId);
        thread.setDaemon(false);
        thread.start();
    }

    @Override public void stop() {
        running.set(false);
        Thread current = thread;
        if (current != null) {
            try { current.join(10_000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }

    @Override public boolean isRunning() { return running.get(); }

    private void loop() {
        while (running.get()) {
            try {
                runOnce();
            } catch (RuntimeException ignored) {
                // 不记录媒体、路径、凭据或完整上游异常；任务状态表达失败。
            }
            try {
                Thread.sleep(pollMs);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** 执行一次对账与有限批次认领；供测试和运行循环共用。 */
    public int runOnce() {
        reconcile();
        int handled = 0;
        for (int index = 0; index < batch; index++) {
            Task task = claim();
            if (task == null) break;
            process(task);
            handled++;
        }
        return handled;
    }

    public void reconcile() {
        transaction.executeWithoutResult(status -> {
            long now = System.currentTimeMillis();
            // 只从已有供应商编号的视频任务补建作品；不生成、不重POST。
            workers.createVideoWorks(schema, now);
            workers.enqueueVideoSave(schema, maxAttempts, now);
            workers.enqueueCleanup(schema, now);
            workers.failExhausted(schema, now);
            expireCaptures(now);
        });
    }

    /** M18：超过120秒无新片段的capturing作品按既有规则部分收尾。 */
    private void expireCaptures(long now) {
        long cutoff = now - captureTimeoutMs;
        for (Map<String, Object> row : workers.capturingWorks(schema, cutoff)) {
            String id = (String) row.get("id");
            long chunks = MigrationSupport.number(row, "chunks");
            int updated = workers.expireCapture(schema, id, chunks > 0 ? "saving" : "failed",
                    chunks > 0 ? "PARTIAL_CAPTURE" : "CAPTURE_EMPTY", now, cutoff);
            if (updated == 1 && chunks > 0) {
                workers.enqueueCaptureFinish(schema, (String) row.get("user_id"), id, maxAttempts, now);
            }
        }
    }

    private Task claim() {
        long now = System.currentTimeMillis();
        return transaction.execute(status -> {
            Map<String, Object> row = workers.claimTask(schema, now);
            if (row == null) return null;
            Task task = task(row);
            long generation = task.generation() + 1;
            int updated = workers.markRunning(schema, workerId, now + leaseMs, generation, now,
                    task.id(), task.generation());
            if (updated != 1) return null;
            return new Task(task.id(), task.type(), task.userId(), task.resourceId(), task.dedupeKey(), "running",
                    task.attempts() + 1, task.maxAttempts(), generation);
        });
    }

    private void process(Task task) {
        try {
            switch (task.type()) {
                case VIDEO_SAVE -> saveVideo(task);
                case CAPTURE_FINISH -> finishCapture(task);
                case CLEANUP -> cleanup(task);
                default -> completeTask(task, "failed", "UNKNOWN_TASK");
            }
        } catch (RuntimeException error) {
            completeTask(task, "failed", "WORKER_FAILED");
        }
    }

    private void saveVideo(Task task) {
        Work work = work(task.resourceId());
        if (work == null) { completeTask(task, "cancelled", null); return; }
        if (work.state().equals("deleted")) { removeFiles(work); completeTask(task, "cancelled", null); return; }
        if (!Set.of("waiting", "saving").contains(work.state())) { completeTask(task, "succeeded", null); return; }
        Job job = job(work.sourceId());
        if (job == null) { failWork(work, "SAVE_FAILED"); completeTask(task, "failed", "SOURCE_MISSING"); return; }
        if (job.state().equals("failed")) { failWork(work, "SAVE_FAILED"); completeTask(task, "succeeded", null); return; }
        if (System.currentTimeMillis() >= job.expiresAt()) {
            failWork(work, "SOURCE_EXPIRED"); completeTask(task, "succeeded", null); return;
        }
        if (ACTIVE_JOB.contains(job.state())) {
            poll(task, work, job);
            return;
        }
        if (!"completed".equals(job.state()) || job.providerId() == null) {
            reschedule(task, work.retries() > 0 ? 10_000L : 2_000L, null);
            return;
        }
        download(task, work, job);
    }

    private void poll(Task task, Work work, Job job) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(providerBase + "/v1/jobs/" + job.providerId()))
                    .timeout(Duration.ofSeconds(15)).header("X-API-KEY", key).GET().build();
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() > 299 || response.body().length > 8192) {
                throw new IllegalStateException();
            }
            JsonNode value = json.readTree(new String(response.body(), StandardCharsets.UTF_8));
            String ident = value.path("job_id").asString("");
            String state = value.path("status").asString("");
            if (!ident.equals(job.providerId()) || !Set.of("pending", "processing", "completed", "failed").contains(state)) {
                throw new IllegalStateException();
            }
            workers.updateVideoState(schema, job.id(), state);
            reschedule(task, 200L, null, true);
        } catch (Exception error) {
            reschedule(task, work.retries() > 0 ? 10_000L : 2_000L, "STATUS_UNAVAILABLE");
        }
    }

    private void download(Task task, Work work, Job job) {
        Path directory;
        Path temporary;
        try {
            directory = storage.directory(work.userId(), work.id());
            Files.createDirectories(directory);
            temporary = directory.resolve(".download-" + task.generation());
        } catch (IOException | RuntimeException error) {
            retry(task, work, "SAVE_FAILED");
            return;
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(providerBase + "/v1/jobs/" + job.providerId() + "/content"))
                    .timeout(Duration.ofSeconds(120)).header("X-API-KEY", key).GET().build();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            String type = response.headers().firstValue("content-type").orElse("").split(";")[0].strip();
            long length = response.headers().firstValueAsLong("content-length").orElse(0);
            if (response.statusCode() < 200 || response.statusCode() > 299
                    || !Set.of("video/mp4", "application/octet-stream").contains(type) || length > MAX_RESULT) {
                response.body().close();
                throw new IllegalStateException();
            }
            long total = 0;
            try (InputStream input = response.body();
                 FileChannel output = FileChannel.open(temporary, StandardOpenOption.CREATE,
                         StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                byte[] buffer = new byte[256 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_RESULT) throw new IllegalStateException();
                    output.write(java.nio.ByteBuffer.wrap(buffer, 0, read));
                }
                output.force(true);
            }
            if (!validMp4(temporary)) throw new IllegalStateException();
            if (!publish(task, work, temporary, total)) {
                Files.deleteIfExists(temporary);
                Work current = work(work.id());
                if (current == null || current.state().equals("deleted")) {
                    if (current != null) removeFiles(current);
                    completeTask(task, "cancelled", null);
                }
            }
        } catch (Exception error) {
            try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            Work current = work(work.id());
            if (current == null || current.state().equals("deleted")) {
                if (current != null) removeFiles(current);
                completeTask(task, "cancelled", null);
            } else {
                retry(task, current, "SAVE_FAILED");
            }
        }
    }

    /** 发布前在同一数据库事务内核对任务租约代次和作品状态；旧代次不能覆盖最终对象。 */
    private boolean publish(Task task, Work work, Path temporary, long bytes) {
        Boolean published = transaction.execute(status -> {
            long now = System.currentTimeMillis();
            if (workers.lockLease(schema, task.id(), workerId, task.generation(), now).isEmpty()) return false;
            String state = workers.lockWorkState(schema, work.id());
            if (state == null || !Set.of("waiting", "saving").contains(state)) {
                return false;
            }
            try {
                Files.move(temporary, storage.directory(work.userId(), work.id()).resolve("result.mp4"),
                        StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException error) {
                throw new IllegalStateException(error);
            }
            workers.markWorkReady(schema, work.id(), bytes,
                    "REFERENCE_SAVE_FAILED".equals(work.errorCode()) ? "REFERENCE_SAVE_FAILED" : null, now);
            workers.markTaskSucceeded(schema, task.id(), task.generation(), now);
            return true;
        });
        return Boolean.TRUE.equals(published);
    }

    private void retry(Task task, Work work, String code) {
        int retries = work.retries() + 1;
        if (retries >= maxAttempts) {
            failWork(work, code);
            completeTask(task, "failed", code);
        } else {
            transaction.executeWithoutResult(status -> workers.markWorkSaving(schema, work.id(), retries,
                    System.currentTimeMillis()));
            reschedule(task, retryMs, code);
        }
    }

    private void finishCapture(Task task) {
        Work work = work(task.resourceId());
        if (work == null) { completeTask(task, "cancelled", null); return; }
        if (work.state().equals("deleted")) { removeFiles(work); completeTask(task, "cancelled", null); return; }
        if (!work.state().equals("saving")) { completeTask(task, "succeeded", null); return; }
        long renewNow = System.currentTimeMillis();
        workers.renewLease(schema, task.id(), workerId, task.generation(), renewNow + leaseMs, renewNow);
        Path directory;
        Path temporary;
        Path target;
        try {
            directory = storage.directory(work.userId(), work.id());
            temporary = directory.resolve(".assembling-" + task.generation());
            target = directory.resolve("result." + work.extension());
            try (FileChannel output = FileChannel.open(temporary, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                for (int index = 0; index < work.chunks(); index++) {
                    byte[] data = storage.read(directory.resolve(String.format("chunk-%06d", index)));
                    output.write(java.nio.ByteBuffer.wrap(data));
                }
                output.force(true);
            }
            if (Files.size(temporary) != work.bytes() || !validVideo(temporary, work.extension())) {
                throw new IOException("incomplete");
            }
        } catch (Exception error) {
            failWork(work, "SAVE_FAILED");
            completeTask(task, "failed", "SAVE_FAILED");
            return;
        }
        Boolean done = transaction.execute(status -> {
            long now = System.currentTimeMillis();
            if (workers.lockLease(schema, task.id(), workerId, task.generation(), now).isEmpty()) return false;
            if (!"saving".equals(workers.lockWorkState(schema, work.id()))) return false;
            try {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException error) {
                throw new IllegalStateException(error);
            }
            workers.markWorkReadySimple(schema, work.id(), work.errorCode(), now);
            for (int index = 0; index < work.chunks(); index++) {
                try { storage.delete(directory.resolve(String.format("chunk-%06d", index))); } catch (IOException ignored) { }
            }
            workers.markTaskSucceeded(schema, task.id(), task.generation(), now);
            return true;
        });
        if (!Boolean.TRUE.equals(done)) {
            try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
        }
    }

    private void cleanup(Task task) {
        Work work = work(task.resourceId());
        if (work != null) removeFiles(work);
        completeTask(task, "succeeded", null);
    }

    private void removeFiles(Work work) {
        try {
            Path directory = storage.directory(work.userId(), work.id());
            if (!Files.isDirectory(directory)) return;
            try (var items = Files.list(directory)) {
                for (Path item : items.toList()) {
                    if (Files.isRegularFile(item) && !Files.isSymbolicLink(item)) Files.deleteIfExists(item);
                }
            }
            Files.deleteIfExists(directory);
        } catch (IOException | RuntimeException ignored) {
            // 删除墓碑已生效；残留文件不再被接口引用。
        }
    }

    private void failWork(Work work, String code) {
        transaction.executeWithoutResult(status -> workers.markWorkFailed(schema, work.id(), code,
                System.currentTimeMillis()));
    }

    private void reschedule(Task task, long delay, String code) {
        reschedule(task, delay, code, false);
    }

    private void reschedule(Task task, long delay, String code, boolean resetAttempts) {
        long now = System.currentTimeMillis();
        transaction.executeWithoutResult(status -> {
            if (resetAttempts) {
                workers.rescheduleTaskReset(schema, task.id(), task.generation(), now + delay, code, now);
            } else {
                workers.rescheduleTask(schema, task.id(), task.generation(), now + delay, code, now);
            }
        });
    }

    private void completeTask(Task task, String state, String code) {
        long now = System.currentTimeMillis();
        workers.completeTask(schema, task.id(), task.generation(), state, code, now);
    }

    private Work work(String id) {
        Map<String, Object> row = workers.work(schema, id);
        if (row == null) return null;
        return new Work((String) row.get("id"), (String) row.get("user_id"), (String) row.get("kind"),
                (String) row.get("source_id"), (String) row.get("state"), (String) row.get("extension"),
                MigrationSupport.number(row, "bytes"), (int) MigrationSupport.number(row, "chunks"),
                (int) MigrationSupport.number(row, "retries"), (String) row.get("error_code"));
    }

    private Job job(String id) {
        Map<String, Object> row = workers.job(schema, id);
        if (row == null) return null;
        return new Job((String) row.get("id"), (String) row.get("state"), (String) row.get("provider_id"),
                MigrationSupport.number(row, "expires_at"));
    }

    private static Task task(Map<String, Object> row) {
        return new Task((String) value(row, "id", "id"), (String) value(row, "type", "type"),
                (String) value(row, "user_id", "userId"), (String) value(row, "resource_id", "resourceId"),
                (String) value(row, "dedupe_key", "dedupeKey"), (String) value(row, "state", "state"),
                (int) MigrationSupport.number(row, "attempts"), (int) MigrationSupport.number(row, "max_attempts"),
                MigrationSupport.number(row, "lease_generation"));
    }

    private static Object value(Map<String, Object> row, String snake, String camel) {
        Object value = row.get(snake);
        return value != null ? value : row.get(camel);
    }

    private static boolean validMp4(Path path) throws IOException {
        byte[] head;
        try (InputStream input = Files.newInputStream(path)) { head = input.readNBytes(8); }
        return head.length == 8 && new String(head, 4, 4, StandardCharsets.ISO_8859_1).equals("ftyp");
    }

    private static boolean validVideo(Path path, String extension) throws IOException {
        byte[] head;
        try (InputStream input = Files.newInputStream(path)) { head = input.readNBytes(32); }
        boolean mp4 = "mp4".equals(extension) && head.length >= 8
                && new String(head, 4, 4, StandardCharsets.ISO_8859_1).equals("ftyp");
        boolean webm = "webm".equals(extension) && head.length >= 4 && head[0] == 0x1a && head[1] == 0x45
                && head[2] == (byte) 0xdf && head[3] == (byte) 0xa3;
        return mp4 || webm;
    }
}
