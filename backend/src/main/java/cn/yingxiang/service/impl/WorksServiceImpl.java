package cn.yingxiang.service.impl;

import cn.yingxiang.service.WorksService;
import cn.yingxiang.manager.StoragePort;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.Mp4;
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
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.works-enabled", havingValue = "true")
public class WorksServiceImpl implements WorksService {

    private final JdbcTemplate jdbc;

    private final StoragePort storage;

    private final JsonMapper json;

    private final TransactionTemplate transaction;

    private final String schema;

    private final ConcurrentHashMap<String, Object> locks = new ConcurrentHashMap<>();

    public WorksServiceImpl(JdbcTemplate jdbc, StoragePort storage, PlatformTransactionManager manager,
                            Environment env, JsonMapper json) {
            this.jdbc = jdbc; this.storage = storage; this.json = json;
            this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M15 works");
            transaction = new TransactionTemplate(manager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            transaction.setTimeout(15);
        }

    public Object lock(String ident) { return locks.computeIfAbsent(ident, ignored -> new Object()); }

    public Work own(String userId, String ident, boolean deleted) {
            var rows = jdbc.queryForList("SELECT * FROM " + schema + "works WHERE id=? AND user_id=?", ident, userId);
            if (rows.isEmpty()) throw new BusinessFailure("WORK_NOT_FOUND", "找不到这件作品。", 404);
            Work work = work(rows.getFirst());
            if (!deleted && work.state().equals("deleted")) throw new BusinessFailure("WORK_NOT_FOUND", "找不到这件作品。", 404);
            return work;
        }

    public List<Map<String, Object>> references(String ident) {
            List<Map<String, Object>> result = new ArrayList<>();
            for (var row : jdbc.queryForList("SELECT * FROM " + schema
                    + "work_references WHERE work_id=? ORDER BY created_at,id", ident)) {
                result.add(MigrationSupport.body("id", row.get("id"), "mime", row.get("mime"),
                        "extension", row.get("extension"), "bytes", MigrationSupport.number(row, "bytes"),
                        "createdAt", MigrationSupport.number(row, "created_at")));
            }
            return result;
        }

    /** M16：编辑作品的提示词历史；只读取本人私有目录。 */
        public List<Map<String, Object>> promptHistory(String userId, String ident) {
            Work work = own(userId, ident, false);
            if (!work.kind().equals("edit")) return List.of();
            Path path = storage.directory(userId, ident).resolve("prompts.json");
            try {
                if (!storage.exists(path)) return List.of();
                byte[] data = storage.read(path);
                if (data.length > MAX_PROMPT_HISTORY) throw new IllegalArgumentException("size");
                JsonNode value = json.readTree(new String(data, java.nio.charset.StandardCharsets.UTF_8));
                if (value == null || !value.isArray() || value.size() > MAX_PROMPT_STATES) throw new IllegalArgumentException("history");
                List<Map<String, Object>> states = new ArrayList<>();
                long previous = 0;
                for (int index = 0; index < value.size(); index++) {
                    Map<String, Object> state = validatePromptState(value.get(index));
                    long at = (Long) state.get("atMs");
                    if (at < previous || (index == 0 && at != 0)) throw new IllegalArgumentException("order");
                    previous = at;
                    states.add(state);
                }
                return states;
            } catch (IOException | RuntimeException error) {
                throw new BusinessFailure("WORK_PROMPTS_UNAVAILABLE", "提示词记录暂时无法读取，请重试。", 503);
            }
        }

    public void promptState(String userId, String ident, int index, JsonNode body) {
            Work work = own(userId, ident, false);
            Map<String, Object> state = validatePromptState(body);
            if (!work.kind().equals("edit") || index < 0 || index >= MAX_PROMPT_STATES) {
                throw new BusinessFailure("INVALID_WORK_PROMPTS", "提示词记录格式无效。", 400);
            }
            List<Map<String, Object>> history = promptHistory(userId, ident);
            if (index < history.size()) {
                if (!history.get(index).equals(state)) {
                    throw new BusinessFailure("WORK_PROMPTS_CONFLICT", "提示词记录与已保存内容不一致。", 409);
                }
                return;
            }
            long at = (Long) state.get("atMs");
            long last = history.isEmpty() ? 0 : (Long) history.getLast().get("atMs");
            if (!work.state().equals("capturing") || index != history.size() || at < last || (index == 0 && at != 0)) {
                throw new BusinessFailure("WORK_PROMPTS_ORDER", "提示词记录顺序无效。", 409);
            }
            List<Object> values = new ArrayList<>(history);
            values.add(state);
            byte[] data;
            try {
                data = json.writeValueAsBytes(values);
            } catch (RuntimeException error) {
                throw new BusinessFailure("INVALID_WORK_PROMPTS", "提示词记录格式无效。", 400);
            }
            if (data.length > MAX_PROMPT_HISTORY) {
                throw new BusinessFailure("WORK_PROMPTS_LIMIT", "提示词记录超过保存上限。", 413);
            }
            try {
                storage.writeAtomic(storage.directory(userId, ident).resolve("prompts.json"), data);
            } catch (IOException error) {
                throw new BusinessFailure("STORAGE_UNAVAILABLE", "作品目录不可用。", 503);
            }
        }

    public static Map<String, Object> validatePromptState(JsonNode body) {
            if (body == null || !body.isObject()) throw invalidPrompts();
            Set<String> fields = new java.util.LinkedHashSet<>();
            body.propertyNames().forEach(fields::add);
            JsonNode at = body.get("atMs"), instructions = body.get("instructions");
            if (!fields.equals(Set.of("atMs", "instructions")) || at == null || !at.isIntegralNumber()
                    || at.asLong() < 0 || at.asLong() > 15_000 || instructions == null || !instructions.isArray()
                    || instructions.size() < 1 || instructions.size() > 12) {
                throw invalidPrompts();
            }
            List<String> items = new ArrayList<>();
            for (JsonNode item : instructions) {
                if (!item.isString() || item.asString().strip().isEmpty() || item.asString().length() > 500
                        || item.asString().indexOf('\0') >= 0) {
                    throw new BusinessFailure("INVALID_WORK_PROMPTS", "每条提示词需为1—500个字符。", 400);
                }
                items.add(item.asString());
            }
            return MigrationSupport.body("atMs", at.asLong(), "instructions", items);
        }

    private static BusinessFailure invalidPrompts() {
            return new BusinessFailure("INVALID_WORK_PROMPTS", "提示词记录格式无效。", 400);
        }

    public Map<String, Object> view(Work work) {        List<Map<String, Object>> refs = new ArrayList<>();
            for (var ref : references(work.id())) {
                refs.add(MigrationSupport.body("id", ref.get("id"), "url",
                        "/api/works/" + work.id() + "/references/" + ref.get("id"), "bytes", ref.get("bytes")));
            }
            boolean canRetry = work.state().equals("failed") && work.kind().equals("video")
                    && !"SOURCE_EXPIRED".equals(work.errorCode());
            return MigrationSupport.body("id", work.id(), "kind", work.kind(), "title", work.title(), "state", work.state(),
                    "createdAt", MigrationSupport.iso(work.createdAt()), "updatedAt", MigrationSupport.iso(work.updatedAt()),
                    "bytes", work.bytes(), "seconds", work.durationMs() / 1000.0, "extension", work.extension(),
                    "message", work.errorCode() == null ? null : ERRORS.get(work.errorCode()), "canRetry", canRetry, "favorite", work.favorite() == 1,
                    "contentUrl", work.state().equals("ready") ? "/api/works/" + work.id() + "/content" : null,
                    "references", refs);
        }

    public Map<String, Object> list(String userId, String kind, int page, int size, String query, boolean favorite, String sort) {
            List<String> where = new ArrayList<>();
            List<Object> args = new ArrayList<>();
            where.add("user_id=?");
            args.add(userId);
            where.add("state<>'deleted'");
            if (!kind.equals("all")) {
                where.add("kind=?");
                args.add(kind);
            }
            if (favorite) where.add("favorite=1");
            String search = query.strip();
            if (search.length() > 60 || search.chars().anyMatch(value -> value < 32)) {
                throw new BusinessFailure("INVALID_WORK_SEARCH", "搜索内容需为0—60个字符，不能含控制字符。", 400);
            }
            if (!search.isEmpty()) {
                where.add("title LIKE ? ESCAPE '\\'");
                args.add("%" + escape(search) + "%");
            }
            String ordering = switch (sort) {
                case "newest" -> "created_at DESC,id DESC";
                case "oldest" -> "created_at ASC,id ASC";
                case "title" -> "lower(title) ASC,title ASC,id ASC";
                default -> throw new BusinessFailure("INVALID_WORK_SORT", "作品排序方式无效。", 400);
            };
            String condition = String.join(" AND ", where);
            int total = count("SELECT count(*) FROM " + schema + "works WHERE " + condition, args.toArray());
            int pages = Math.max(1, (total + size - 1) / size);
            int actual = Math.min(page, pages);
            List<Object> pageArgs = new ArrayList<>(args);
            pageArgs.add(size);
            pageArgs.add((actual - 1) * size);
            List<Map<String, Object>> items = new ArrayList<>();
            for (var row : jdbc.queryForList("SELECT * FROM " + schema + "works WHERE " + condition
                    + " ORDER BY " + ordering + " LIMIT ? OFFSET ?", pageArgs.toArray())) {
                items.add(view(work(row)));
            }
            return MigrationSupport.body("items", items, "page", actual, "pages", pages, "pageSize", size, "total", total);
        }

    public Work create(String userId, JsonNode body) {
            Set<String> fields = new java.util.LinkedHashSet<>();
            body.propertyNames().forEach(fields::add);
            if (!fields.equals(Set.of("id", "kind", "mime", "seconds", "ownerId"))
                    || !body.get("ownerId").isString() || !body.get("ownerId").asString().equals(userId)) {
                throw new BusinessFailure("INVALID_WORK", "保存账号或作品参数无效。", 400);
            }
            JsonNode ident = body.get("id"), kind = body.get("kind"), mime = body.get("mime"), seconds = body.get("seconds");
            if (!ident.isString() || !MigrationSupport.isUuid(ident.asString()) || !kind.isString()
                    || !Set.of("realtime", "edit").contains(kind.asString()) || !mime.isString()
                    || !Set.of("video/mp4", "video/webm").contains(mime.asString())
                    || !seconds.isIntegralNumber() || !List.of(15, 30, 60).contains(seconds.asInt())) {
                throw new BusinessFailure("INVALID_WORK", "作品参数无效。", 400);
            }
            String id = ident.asString(), type = kind.asString(), media = mime.asString();
            storage.directory(userId, id);
            return transaction.execute(status -> {
                var rows = jdbc.queryForList("SELECT * FROM " + schema + "works WHERE id=?", id);
                if (!rows.isEmpty()) {
                    Work old = work(rows.getFirst());
                    if (!old.userId().equals(userId) || old.state().equals("deleted")
                            || !old.kind().equals(type) || !old.mime().equals(media)) {
                        throw new BusinessFailure("WORK_NOT_FOUND", "找不到这件作品。", 404);
                    }
                    return old;
                }
                long now = System.currentTimeMillis();
                Work work = new Work(id, userId, type, null, KINDS.get(type), "capturing", media,
                        media.equals("video/mp4") ? "mp4" : "webm", 0, 0, seconds.asInt() * 1000L, now, now, null, 0, 0);
                jdbc.update("INSERT INTO " + schema + "works(id,user_id,kind,title,state,mime,extension,bytes,chunks,duration_ms,"
                                + "created_at,updated_at,retries,favorite) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        work.id(), work.userId(), work.kind(), work.title(), work.state(), work.mime(), work.extension(),
                        work.bytes(), work.chunks(), work.durationMs(), work.createdAt(), work.updatedAt(), work.retries(), work.favorite());
                return work;
            });
        }

    public void chunk(String userId, String ident, int index, byte[] data) {
            Work work = own(userId, ident, false);
            if (work.kind().equals("video") || data.length == 0 || index < 0 || index > 600) {
                throw new BusinessFailure("INVALID_CHUNK", "录像片段无效。", 400);
            }
            Path path = storage.directory(userId, ident).resolve(String.format("chunk-%06d", index));
            if (index < work.chunks()) {
                try {
                    if (!storage.exists(path) || !digest(storage.read(path)).equals(digest(data))) {
                        throw new BusinessFailure("CHUNK_CONFLICT", "录像片段与已保存内容不一致。", 409);
                    }
                } catch (IOException error) {
                    throw new BusinessFailure("CHUNK_CONFLICT", "录像片段与已保存内容不一致。", 409);
                }
                return;
            }
            if (!work.state().equals("capturing") || index != work.chunks()) {
                throw new BusinessFailure("CHUNK_ORDER", "录像片段顺序无效。", 409);
            }
            if (work.bytes() + data.length > MAX_REALTIME) {
                throw new BusinessFailure("WORK_TOO_LARGE", "实时录像超过32MB保存上限。", 413);
            }
            try {
                storage.writeAtomic(path, data);
            } catch (IOException error) {
                throw new BusinessFailure("STORAGE_UNAVAILABLE", "作品目录不可用。", 503);
            }
            transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                            + "works SET chunks=?,bytes=?,updated_at=? WHERE id=? AND state='capturing'",
                    index + 1, work.bytes() + data.length, System.currentTimeMillis(), ident));
        }

    public void complete(String userId, String ident, Integer durationMs, boolean interrupted,
                             boolean referenceFailed, boolean promptsFailed) {
            Work work = own(userId, ident, false);
            if (!work.state().equals("capturing")) return;
            if (durationMs != null) {
                transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                        + "works SET duration_ms=? WHERE id=?", durationMs, ident));
            }
            String state = work.chunks() > 0 ? "saving" : "failed";
            String error = work.chunks() > 0 ? (interrupted ? "PARTIAL_CAPTURE" : null) : "CAPTURE_EMPTY";
            updateState(ident, state, error);
            if (work.chunks() > 0) {
                if (referenceFailed) updateState(ident, state, "REFERENCE_SAVE_FAILED");
                if (promptsFailed) updateState(ident, state, "PROMPTS_SAVE_FAILED");
                finalize(own(userId, ident, false));
            }
        }

    public void finalize(Work work) {
            Path directory = storage.directory(work.userId(), work.id());
            Path temporary = directory.resolve(".assembling");
            Path target = directory.resolve("result." + work.extension());
            try {
                Files.createDirectories(directory);
                try (FileChannel output = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                        StandardOpenOption.WRITE)) {
                    for (int index = 0; index < work.chunks(); index++) {
                        Path chunk = directory.resolve(String.format("chunk-%06d", index));
                        byte[] data = storage.read(chunk);
                        output.write(java.nio.ByteBuffer.wrap(data));
                    }
                    output.force(true);
                }
                validateVideo(temporary, work.extension());
                if (Files.size(temporary) != work.bytes()) throw new IOException("incomplete");
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                updateState(work.id(), "ready", work.errorCode());
                for (int index = 0; index < work.chunks(); index++) {
                    storage.delete(directory.resolve(String.format("chunk-%06d", index)));
                }
            } catch (Exception error) {
                updateState(work.id(), "failed", "SAVE_FAILED");
            } finally {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            }
        }

    public void reference(String userId, String ident, String refId, String mime, byte[] data) {
            Work work = own(userId, ident, false);
            if (!MigrationSupport.isUuid(refId) || !Set.of("image/png", "image/jpeg", "image/webp").contains(mime)) {
                throw new BusinessFailure("INVALID_REFERENCE", "参考图片格式无效。", 400);
            }
            try {
                Mp4.validateImage(data, mime);
            } catch (IllegalArgumentException error) {
                throw new BusinessFailure("INVALID_REFERENCE", "参考图片无法读取，请使用有效的JPG、PNG或WebP图片。", 400);
            }
            List<Map<String, Object>> refs = references(ident);
            String extension = Map.of("image/png", "png", "image/jpeg", "jpg", "image/webp", "webp").get(mime);
            Path path = storage.directory(userId, ident).resolve("reference-" + refId + "." + extension);
            var old = refs.stream().filter(ref -> refId.equals(ref.get("id"))).findFirst().orElse(null);
            if (old != null) {
                try {
                    if (!mime.equals(old.get("mime")) || !storage.exists(path)
                            || !java.util.Arrays.equals(storage.read(path), data)) {
                        throw new BusinessFailure("REFERENCE_CONFLICT", "这张参考图的保存内容不一致。", 409);
                    }
                } catch (IOException error) {
                    throw new BusinessFailure("REFERENCE_CONFLICT", "这张参考图的保存内容不一致。", 409);
                }
                return;
            }
            if (!Set.of("capturing", "waiting", "saving").contains(work.state()) || refs.size() >= 24) {
                throw new BusinessFailure("REFERENCE_LIMIT", "这件作品不能再添加参考图。", 409);
            }
            try {
                storage.writeAtomic(path, data);
            } catch (IOException error) {
                throw new BusinessFailure("STORAGE_UNAVAILABLE", "作品目录不可用。", 503);
            }
            transaction.executeWithoutResult(status -> jdbc.update("INSERT INTO " + schema
                            + "work_references(id,work_id,mime,extension,bytes,created_at) VALUES (?,?,?,?,?,?)",
                    refId, ident, mime, extension, data.length, System.currentTimeMillis()));
        }

    public Map<String, Object> change(String userId, String ident, JsonNode body) {
            Work work = own(userId, ident, false);
            Set<String> fields = new java.util.LinkedHashSet<>();
            body.propertyNames().forEach(fields::add);
            if (fields.equals(Set.of("title"))) {
                JsonNode title = body.get("title");
                if (!title.isString() || title.asString().strip().length() < 1 || title.asString().strip().length() > 60
                        || title.asString().chars().anyMatch(value -> value < 32)) {
                    throw new BusinessFailure("INVALID_WORK_TITLE", "作品名称需为1—60个字符，不能含换行。", 400);
                }
                transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                        + "works SET title=?,updated_at=? WHERE id=?", title.asString().strip(), System.currentTimeMillis(), ident));
            } else if (fields.equals(Set.of("favorite"))) {
                JsonNode favorite = body.get("favorite");
                if (!favorite.isBoolean()) throw new BusinessFailure("INVALID_WORK_FAVORITE", "作品收藏状态无效。", 400);
                transaction.executeWithoutResult(status -> jdbc.update("UPDATE " + schema
                        + "works SET favorite=? WHERE id=?", favorite.asBoolean() ? 1 : 0, ident));
            } else if (fields.equals(Set.of("action")) && "retry".equals(body.get("action").asString())) {
                if (!work.kind().equals("video") || !work.state().equals("failed") || "SOURCE_EXPIRED".equals(work.errorCode())) {
                    throw new BusinessFailure("WORK_RETRY_UNAVAILABLE", "这件作品暂时不能重试保存。", 409);
                }
                updateState(ident, "waiting", null, "retries", 0);
            } else if (fields.equals(Set.of("action")) && "delete".equals(body.get("action").asString())) {
                if (Set.of("capturing", "waiting", "saving").contains(work.state())) {
                    throw new BusinessFailure("WORK_SAVING", "请等待生成和保存结束后再删除。", 409);
                }
                transaction.executeWithoutResult(status -> {
                    jdbc.update("UPDATE " + schema + "works SET state='deleted',title='',favorite=0,error_code=NULL,updated_at=? WHERE id=?",
                            System.currentTimeMillis(), ident);
                    jdbc.update("DELETE FROM " + schema + "work_references WHERE work_id=?", ident);
                });
                removeFiles(work);
                return Map.of("accepted", true);
            } else {
                throw new BusinessFailure("INVALID_WORK", "作品操作无效。", 400);
            }
            return view(own(userId, ident, false));
        }

    public void removeFiles(Work work) {
            Path directory = storage.directory(work.userId(), work.id());
            try {
                if (Files.isDirectory(directory)) {
                    try (var items = Files.list(directory)) {
                        for (Path item : items.toList()) {
                            if (Files.isRegularFile(item) && !Files.isSymbolicLink(item)) Files.deleteIfExists(item);
                        }
                    }
                    Files.deleteIfExists(directory);
                }
            } catch (IOException ignored) {
                // 状态已删除；残留文件不再被接口引用，M18清理任务再收尾。
            }
        }

    private void updateState(String ident, String state, String error, Object... extra) {
            transaction.executeWithoutResult(status -> {
                if (extra.length >= 2 && "retries".equals(extra[0])) {
                    jdbc.update("UPDATE " + schema + "works SET state=?,error_code=?,retries=?,updated_at=? "
                            + "WHERE id=? AND state<>'deleted'", state, error, extra[1], System.currentTimeMillis(), ident);
                } else {
                    jdbc.update("UPDATE " + schema + "works SET state=?,error_code=?,updated_at=? WHERE id=? AND state<>'deleted'",
                            state, error, System.currentTimeMillis(), ident);
                }
            });
        }

    private static void validateVideo(Path path, String extension) throws IOException {
            byte[] head;
            try (var stream = Files.newInputStream(path)) { head = stream.readNBytes(32); }
            boolean mp4 = extension.equals("mp4") && head.length >= 8 && new String(head, 4, 4,
                    java.nio.charset.StandardCharsets.ISO_8859_1).equals("ftyp");
            boolean webm = extension.equals("webm") && head.length >= 4 && head[0] == 0x1a && head[1] == 0x45
                    && head[2] == (byte) 0xdf && head[3] == (byte) 0xa3;
            if (!mp4 && !webm) throw new IOException("invalid media");
        }

    private int count(String sql, Object... args) {
            Integer value = jdbc.queryForObject(sql, Integer.class, args);
            return value == null ? 0 : value;
        }

    private static Work work(Map<String, Object> row) {
            return new Work((String) row.get("id"), (String) row.get("user_id"), (String) row.get("kind"),
                    (String) row.get("source_id"), (String) row.get("title"), (String) row.get("state"),
                    (String) row.get("mime"), (String) row.get("extension"), MigrationSupport.number(row, "bytes"),
                    (int) MigrationSupport.number(row, "chunks"), MigrationSupport.number(row, "duration_ms"),
                    MigrationSupport.number(row, "created_at"), MigrationSupport.number(row, "updated_at"),
                    (String) row.get("error_code"), (int) MigrationSupport.number(row, "retries"),
                    (int) MigrationSupport.number(row, "favorite"));
        }

    private static String digest(byte[] data) {
            try {
                return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
            } catch (java.security.NoSuchAlgorithmException error) {
                throw new IllegalStateException();
            }
        }

    private static String escape(String value) {
            return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        }
}
