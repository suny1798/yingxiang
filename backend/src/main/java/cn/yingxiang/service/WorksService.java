package cn.yingxiang.service;

import cn.yingxiang.service.impl.WorksServiceImpl;
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

public interface WorksService {

    public static final long MAX_REALTIME = 32L * 1024 * 1024;

    public static final int MAX_PROMPT_STATES = 128;

    public static final long MAX_PROMPT_HISTORY = 4L * 1024 * 1024;

    public static final Map<String, String> KINDS = Map.of("realtime", "实时换装", "video", "视频换装", "edit", "实时编辑");

    public static final Map<String, String> ERRORS = Map.of(
                "SAVE_FAILED", "视频未能保存，可重试保存已有结果。", "SOURCE_EXPIRED", "原结果已过期，无法补存。",
                "REFERENCE_SAVE_FAILED", "服装参考图未能完整保存，请查看作品中的已保存内容。",
                "PROMPTS_SAVE_FAILED", "部分提示词未能保存，请查看作品中的已保存内容。",
                "CAPTURE_EMPTY", "未收到可保存的生成画面。", "PARTIAL_CAPTURE", "连接中断，已保存收到的画面片段。",
                "CAPTURE_FAILED", "部分画面未能上传，已保留收到的片段。");

    public record Work(String id, String userId, String kind, String sourceId, String title, String state, String mime,
                    String extension, long bytes, int chunks, long durationMs, long createdAt, long updatedAt,
                    String errorCode, int retries, int favorite) {}

    public Object lock(String ident);

    public Work own(String userId, String ident, boolean deleted);

    public List<Map<String, Object>> references(String ident);

    public List<Map<String, Object>> promptHistory(String userId, String ident);

    public void promptState(String userId, String ident, int index, JsonNode body);

    public static Map<String, Object> validatePromptState(JsonNode body) { return WorksServiceImpl.validatePromptState(body); }

    public Map<String, Object> view(Work work);

    public Map<String, Object> list(String userId, String kind, int page, int size, String query, boolean favorite, String sort);

    public Work create(String userId, JsonNode body);

    public void chunk(String userId, String ident, int index, byte[] data);

    public void complete(String userId, String ident, Integer durationMs, boolean interrupted,
                             boolean referenceFailed, boolean promptsFailed);

    public void finalize(Work work);

    public void reference(String userId, String ident, String refId, String mime, byte[] data);

    public Map<String, Object> change(String userId, String ident, JsonNode body);

    public void removeFiles(Work work);
}
