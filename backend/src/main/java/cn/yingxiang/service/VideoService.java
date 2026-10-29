package cn.yingxiang.service;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.Multipart;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.manager.Mp4;
import cn.yingxiang.mapper.MigrationAccounts;
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

public interface VideoService {

    public static final String MODEL = "lucy-vton-3.6";

    public static final String CONSENT = "2026-10-26-video-save-v1";

    public static final String PROMPT = "Dress the person in the garment from the reference image. "
                + "Preserve the person, face, body, pose, background and lighting.";

    public static final long RESULT_WINDOW_MS = 86_400_000L;

    public static final long USD_PER_SECOND_MICRO = 40_000L;

    public record Job(String id, String userId, String state, long createdAt, long expiresAt, long secondsMilli,
                   long microUsd, String providerId, Long checkedAt) {}

    public boolean configured();

    public long budgetMicro();

    public int maximum();

    public boolean allowed(String userId);

    public Map<String, Object> status(String userId);

    public Map<String, Object> previous(String userId, String ident);

    public Map<String, Object> history(String userId, boolean archived, int page, int size);

    public Map<String, Object> historyChange(String userId, String ident, JsonNode body);

    public Map<String, Object> submit(String userId, String ident, byte[] video, byte[] image, String mime, double seconds);

    public Map<String, Object> get(String userId, String ident);

    public Content content(String userId, String ident);

    public record Content(InputStream stream, long length, String jobId) {}

    public boolean enterUpload();

    public void leaveUpload();

    public void prepareRateLimit();

    public Prepared prepare(byte[] data);

    public record Prepared(byte[] bytes, double seconds, boolean removed) {}
}
