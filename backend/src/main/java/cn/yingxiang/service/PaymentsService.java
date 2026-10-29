package cn.yingxiang.service;

import cn.yingxiang.service.impl.PaymentsServiceImpl;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.StripeGateway;
import cn.yingxiang.config.RuntimePolicy;
import cn.yingxiang.mapper.MigrationAccounts;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface PaymentsService {

    public record Plan(String name, int amount, int credits, List<String> scenes) {}

    public record Product(String sku, Integer seconds, Integer count, int amount, String currency,
                       String planId, Integer credits, String templateVersion) {}

    public record Order(String id, String userId, String requestId, String sku, Integer seconds, Integer count,
                     int amount, String planId, Integer credits, String currency, String state, long createdAt,
                     String sessionId, String checkoutUrl, Long expiresAt, Long fulfilledAt, String requestSnapshot) {}

    public boolean enabled();

    public void requireEnabled();

    public Map<String, Object> status();

    public static Product product(String sku) { return PaymentsServiceImpl.product(sku); }

    public static Map<String, Object> checkoutParams(Order order, String publicOrigin) { return PaymentsServiceImpl.checkoutParams(order, publicOrigin); }

    public Map<String, Object> list(String hashed);

    public Order reserve(String hashed, String sku, String requestId, String publicOrigin);

    public Order own(String hashed, String ident);

    public Map<String, Object> checkout(String hashed, JsonNode body, String publicOrigin);

    public Map<String, Object> reconcile(String hashed, JsonNode body, String publicOrigin);

    public Map<String, Object> webhook(byte[] payload, String signature);

    public void apply(Map<String, Object> value, String eventId, boolean failed);

    public static boolean safeUrl(Object value) { return PaymentsServiceImpl.safeUrl(value); }

    public static String hex(byte[] value) { return PaymentsServiceImpl.hex(value); }
}
