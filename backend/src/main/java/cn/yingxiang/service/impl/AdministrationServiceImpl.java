package cn.yingxiang.service.impl;

import cn.yingxiang.service.AdministrationService;
import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.mapper.MigrationAccounts;
import org.springframework.beans.factory.ObjectProvider;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import cn.yingxiang.service.PaymentsService;
import cn.yingxiang.service.VideoService;

@Service
@Profile("local")
@ConditionalOnProperty(name = "migration.admin-enabled", havingValue = "true")
public class AdministrationServiceImpl implements AdministrationService {

    private static final String INVALID = "管理参数无效，请核对填写内容。";

    private static final String INVALID_MUTATION = "请填写有效操作编号及至少3字的操作原因。";

    private static final String INSUFFICIENT = "只能回收未使用、未预留的次数。";

    private final JdbcTemplate jdbc;

    private final MigrationAccounts accounts;

    private final PaymentsService payments;

    private final VideoService video;

    private final JsonMapper json;

    private final TransactionTemplate transaction;

    private final String schema;

    private final Environment env;

    public AdministrationServiceImpl(JdbcTemplate jdbc, MigrationAccounts accounts, ObjectProvider<PaymentsService> payments,
                                     ObjectProvider<VideoService> video,
                                     PlatformTransactionManager manager, Environment env, JsonMapper json) {
            this.jdbc = jdbc; this.accounts = accounts; this.payments = payments.getIfAvailable();
            this.video = video.getIfAvailable(); this.json = json; this.env = env;
            this.schema = MigrationSupport.requireIsolatedSchema(jdbc, env, "M13 admin");
            transaction = new TransactionTemplate(manager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            transaction.setTimeout(10);
        }

    public void authorize(String hashed) {
            transaction.executeWithoutResult(status -> requireAdmin(hashed));
        }

    private MigrationAccounts.User requireAdmin(String hashed) {
            MigrationAccounts.User actor = accounts.require(hashed);
            if (!"admin".equals(actor.role())) throw new BusinessFailure("ADMIN_REQUIRED", "需要管理员权限。", 403);
            return actor;
        }

    public Map<String, Object> overview(String hashed) {
            return transaction.execute(status -> {
                requireAdmin(hashed);
                int users = count("SELECT count(*) FROM " + schema + "users");
                int admins = count("SELECT count(*) FROM " + schema + "users WHERE role='admin' AND disabled=0");
                int disabled = count("SELECT count(*) FROM " + schema + "users WHERE disabled=1");
                int jobs = count("SELECT count(*) FROM " + schema + "video_jobs");
                int attempts = count("SELECT count(*) FROM " + schema + "usage_attempts");
                int orders = count("SELECT count(*) FROM " + schema + "orders");
                int unknown = count("SELECT count(*) FROM " + schema + "video_jobs WHERE state='unknown'")
                        + count("SELECT count(*) FROM " + schema + "usage_attempts WHERE state='unknown'");
                List<Map<String, Object>> services = new ArrayList<>();
                for (String scene : List.of("studio", "video", "prompt")) {
                    boolean configured = scene.equals("studio")
                            ? Boolean.parseBoolean(env.getProperty("migration.studio-fixture-enabled", "false"))
                            : scene.equals("video") && video != null && video.configured();
                    long reserved = 0;
                    for (var row : jdbc.queryForList("SELECT coalesce(sum(micro_usd),0) AS total FROM " + schema
                            + "budget_reservations WHERE scene=?", scene)) reserved += MigrationSupport.number(row, "total");
                    Object budget = scene.equals("video") && video != null ? video.budgetMicro() / 1_000_000.0 : null;
                    Object maximum = scene.equals("video") && video != null ? video.maximum() : null;
                    services.add(MigrationSupport.body("scene", scene, "configured", configured, "paused", paused(scene),
                            "budgetUsd", budget, "reservedUsd", reserved / 1_000_000.0, "maxRequests", maximum,
                            "requests", scene.equals("video") ? jobs
                                    : count("SELECT count(*) FROM " + schema + "usage_attempts WHERE scene=?", scene)));
                }
                return MigrationSupport.body("users", users, "admins", admins, "disabledUsers", disabled, "videoJobs", jobs,
                        "usageAttempts", attempts, "sandboxOrders", orders, "unknownResults", unknown,
                        "sandboxEnabled", payments != null && payments.enabled(), "livePaymentsEnabled", false,
                        "services", services);
            });
        }

    public Map<String, Object> listUsers(String hashed, String query, int page) {
            return transaction.execute(status -> {
                requireAdmin(hashed);
                String where = "";
                List<Object> args = new ArrayList<>();
                if (!query.isEmpty()) {
                    where = " WHERE username LIKE ? ESCAPE '\\'";
                    args.add("%" + escape(query) + "%");
                }
                int total = count("SELECT count(*) FROM " + schema + "users" + where, args.toArray());
                List<Map<String, Object>> items = new ArrayList<>();
                for (var row : jdbc.queryForList("SELECT id,username,created_at,role,disabled FROM " + schema + "users" + where
                        + " ORDER BY created_at DESC,id LIMIT 20 OFFSET ?", concat(args, (page - 1) * 20))) {
                    items.add(MigrationSupport.body("id", row.get("id"), "username", row.get("username"),
                            "role", row.get("role"), "disabled", MigrationSupport.number(row, "disabled") != 0,
                            "createdAt", MigrationSupport.iso(MigrationSupport.number(row, "created_at")),
                            "durations", durations((String) row.get("id"))));
                }
                return MigrationSupport.body("items", items, "total", total, "page", page,
                        "pages", Math.max(1, (total + 19) / 20));
            });
        }

    public Map<String, Object> records(String hashed, String kind, String query, String state, int page) {
            String table = switch (kind) {
                case "video" -> "video_jobs";
                case "usage" -> "usage_attempts";
                case "orders" -> "orders";
                default -> throw new BusinessFailure("INVALID_REQUEST", "请求参数无效。", 400);
            };
            return transaction.execute(status -> {
                requireAdmin(hashed);
                List<String> where = new ArrayList<>();
                List<Object> args = new ArrayList<>();
                if (!query.isEmpty()) {
                    where.add("(u.username LIKE ? ESCAPE '\\' OR t.id LIKE ? ESCAPE '\\')");
                    args.add("%" + escape(query) + "%");
                    args.add("%" + escape(query) + "%");
                }
                if (!state.isEmpty()) {
                    where.add("t.state=?");
                    args.add(state);
                }
                String condition = where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where);
                String from = " FROM " + schema + table + " t JOIN " + schema + "users u ON u.id=t.user_id";
                int total = count("SELECT count(*)" + from + condition, args.toArray());
                List<Map<String, Object>> items = new ArrayList<>();
                String sql = "SELECT t.*,u.username" + from + condition + " ORDER BY t.created_at DESC,t.id LIMIT 20 OFFSET ?";
                for (var row : jdbc.queryForList(sql, concat(args, (page - 1) * 20))) {
                    Map<String, Object> item = MigrationSupport.body("id", row.get("id"), "username", row.get("username"),
                            "state", row.get("state"), "createdAt", MigrationSupport.iso(MigrationSupport.number(row, "created_at")),
                            "scene", kind.equals("video") ? "video" : kind.equals("usage") ? row.get("scene") : "stripe_sandbox");
                    item.put("seconds", kind.equals("video") ? MigrationSupport.number(row, "seconds_milli") / 1000.0
                            : kind.equals("usage") ? row.get("seconds") : null);
                    item.put("amount", kind.equals("orders") ? row.get("amount") : null);
                    item.put("title", kind.equals("orders") ? row.get("sku") : null);
                    items.add(item);
                }
                return MigrationSupport.body("items", items, "total", total, "page", page,
                        "pages", Math.max(1, (total + 19) / 20));
            });
        }

    public Map<String, Object> audit(String hashed, int page) {
            return transaction.execute(status -> {
                requireAdmin(hashed);
                int total = count("SELECT count(*) FROM " + schema + "admin_audit");
                List<Map<String, Object>> items = new ArrayList<>();
                for (var row : jdbc.queryForList("SELECT a.*,u.username FROM " + schema + "admin_audit a JOIN " + schema
                        + "users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id LIMIT 20 OFFSET ?", (page - 1) * 20)) {
                    items.add(MigrationSupport.body("id", row.get("id"), "actor", row.get("username"),
                            "action", row.get("action"), "target", row.get("target"), "reason", row.get("reason"),
                            "changes", row.get("changes"), "createdAt", MigrationSupport.iso(MigrationSupport.number(row, "created_at"))));
                }
                return MigrationSupport.body("items", items, "total", total, "page", page,
                        "pages", Math.max(1, (total + 19) / 20));
            });
        }

    public Map<String, Object> settingsView(String hashed) {
            return transaction.execute(status -> {
                requireAdmin(hashed);
                var services = setting("services");
                Map<String, Object> serviceView = new LinkedHashMap<>();
                serviceView.put("version", services.version());
                for (String scene : List.of("studio", "video", "prompt")) {
                    serviceView.put(scene, Boolean.TRUE.equals(services.value().get(scene)));
                }
                return MigrationSupport.body("services", serviceView, "announcement", announcementView(setting("announcement")));
            });
        }

    public Map<String, Object> announcement() {
            return transaction.execute(status -> announcementView(setting("announcement")));
        }

    public Map<String, Object> userChange(String hashed, String ident, JsonNode body) {
            Map<String, Object> input = validateMutation(body, "user");
            return mutate(hashed, "user.update", ident, input, (actor, value) -> {
                var row = jdbc.queryForList("SELECT role,disabled FROM " + schema + "users WHERE id=? FOR UPDATE", ident);
                if (row.isEmpty()) throw new BusinessFailure("NOT_FOUND", "账号不存在。", 404);
                String role = (String) row.getFirst().get("role");
                boolean disabled = MigrationSupport.number(row.getFirst(), "disabled") != 0;
                String nextRole = (String) value.get("role");
                boolean nextDisabled = (Boolean) value.get("disabled");
                if (ident.equals(actor.id()) && (!nextRole.equals("admin") || nextDisabled)) {
                    throw new BusinessFailure("ADMIN_SELF_LOCK", "不能撤销自己的管理员权限或暂停自己。", 409);
                }
                if (role.equals("admin") && !disabled && (!nextRole.equals("admin") || nextDisabled)) {
                    if (count("SELECT count(*) FROM " + schema + "users WHERE role='admin' AND disabled=0") <= 1) {
                        throw new BusinessFailure("LAST_ADMIN", "至少保留一名可用管理员。", 409);
                    }
                }
                jdbc.update("UPDATE " + schema + "users SET role=?,disabled=? WHERE id=?", nextRole, nextDisabled ? 1 : 0, ident);
                if (nextDisabled || !nextRole.equals(role)) {
                    jdbc.update("DELETE FROM " + schema + "auth_sessions WHERE user_id=?", ident);
                }
                return MigrationSupport.body("before", Map.of("role", role, "disabled", disabled),
                        "after", Map.of("role", nextRole, "disabled", nextDisabled));
            });
        }

    public Map<String, Object> quotaChange(String hashed, String ident, JsonNode body) {
            Map<String, Object> input = validateMutation(body, "quota");
            return mutate(hashed, "quota.adjust", ident, input, (actor, value) -> {
                if (accounts.byId(ident) == null) throw new BusinessFailure("NOT_FOUND", "账号不存在。", 404);
                int seconds = (Integer) value.get("seconds");
                int delta = (Integer) value.get("delta");
                if (delta == 0) throw new BusinessFailure("INVALID_REQUEST", "调整次数不能为0。", 400);
                List<Map<String, Object>> rows = jdbc.queryForList("SELECT id,total,reserved,used,revoked FROM " + schema
                        + "entitlement_grants WHERE user_id=? AND seconds=? AND environment='real_usage' ORDER BY id FOR UPDATE",
                        ident, seconds);
                long before = 0;
                for (var row : rows) {
                    before += MigrationSupport.number(row, "total") - MigrationSupport.number(row, "reserved")
                            - MigrationSupport.number(row, "used") - MigrationSupport.number(row, "revoked");
                }
                if (before + delta < 0) throw new BusinessFailure("INSUFFICIENT_AVAILABLE", INSUFFICIENT, 409);
                if (delta > 0) {
                    accounts.grant(ident, seconds, delta, "admin", "admin:" + value.get("requestId"), "real_usage");
                } else {
                    int remaining = -delta;
                    for (var row : rows) {
                        int quantity = (int) Math.min(remaining, MigrationSupport.number(row, "total")
                                - MigrationSupport.number(row, "reserved") - MigrationSupport.number(row, "used")
                                - MigrationSupport.number(row, "revoked"));
                        if (quantity > 0) {
                            String grantId = (String) row.get("id");
                            jdbc.update("UPDATE " + schema + "entitlement_grants SET revoked=revoked+? WHERE id=?", quantity, grantId);
                            jdbc.update("INSERT INTO " + schema + "entitlement_entries(id,grant_id,operation_key,kind,quantity,created_at) "
                                            + "VALUES (?,?,?,'revoke',?,?)", MigrationSupport.uuid(), grantId,
                                    "admin-revoke:" + value.get("requestId") + ":" + grantId, quantity, System.currentTimeMillis());
                        }
                        remaining -= quantity;
                        if (remaining == 0) break;
                    }
                }
                return MigrationSupport.body("before", before, "after", before + delta, "seconds", seconds);
            });
        }

    public Map<String, Object> settingsChange(String hashed, String key, JsonNode body) {
            if (!Set.of("services", "announcement").contains(key)) throw new BusinessFailure("NOT_FOUND", "设置不存在。", 404);
            Map<String, Object> input = validateMutation(body, "settings");
            return mutate(hashed, key + ".update", key, input, (actor, value) -> {
                var before = setting(key);
                if (before.version() != (Integer) value.get("version")) {
                    throw new BusinessFailure("SETTINGS_CONFLICT", "设置已被更新，请刷新后重新确认。", 409);
                }
                Map<String, Object> after;
                if (key.equals("services")) {
                    if (!(value.get("paused") instanceof Map<?, ?> paused)) {
                        throw new BusinessFailure("INVALID_REQUEST", "请填写完整的服务暂停状态。", 400);
                    }
                    after = new LinkedHashMap<>();
                    for (String scene : List.of("studio", "video", "prompt")) after.put(scene, paused.get(scene));
                } else {
                    if (value.get("enabled") == null || value.get("zh") == null || value.get("en") == null) {
                        throw new BusinessFailure("INVALID_REQUEST", "启用公告时，请填写中英文正文。", 400);
                    }
                    boolean enabled = (Boolean) value.get("enabled");
                    String zh = ((String) value.get("zh")).strip(), en = ((String) value.get("en")).strip();
                    if (enabled && (zh.isEmpty() || en.isEmpty())) {
                        throw new BusinessFailure("INVALID_REQUEST", "启用公告时，请填写中英文正文。", 400);
                    }
                    after = MigrationSupport.body("enabled", enabled, "zh", zh, "en", en);
                }
                jdbc.update("DELETE FROM " + schema + "admin_settings WHERE key=?", key);
                jdbc.update("INSERT INTO " + schema + "admin_settings(key,value,version) VALUES (?,?,?)", key,
                        json.writeValueAsString(after), before.version() + 1);
                return MigrationSupport.body("before", before.value(), "after", after);
            });
        }

    private Map<String, Object> mutate(String hashed, String action, String target, Map<String, Object> input,
                                           java.util.function.BiFunction<MigrationAccounts.User, Map<String, Object>, Map<String, Object>> callback) {
            return transaction.execute(status -> {
                MigrationAccounts.User actor = requireAdmin(hashed);
                var old = jdbc.queryForList("SELECT actor_id,action,target,changes FROM " + schema
                        + "admin_audit WHERE request_id=?", input.get("requestId"));
                if (!old.isEmpty()) {
                    var row = old.getFirst();
                    Map<String, Object> changes = json.readValue((String) row.get("changes"), Map.class);
                    if (!actor.id().equals(row.get("actor_id")) || !action.equals(row.get("action"))
                            || !target.equals(row.get("target")) || !input.equals(changes.get("input"))) {
                        throw new BusinessFailure("REQUEST_CONFLICT", "操作编号已用于不同的修改，请重新核对。", 409);
                    }
                    return Map.of("accepted", true);
                }
                Map<String, Object> changes = callback.apply(actor, input);
                Map<String, Object> stored = new LinkedHashMap<>();
                stored.put("input", input);
                stored.putAll(changes);
                jdbc.update("INSERT INTO " + schema + "admin_audit(id,request_id,actor_id,action,target,reason,changes,created_at) "
                                + "VALUES (?,?,?,?,?,?,?,?)", MigrationSupport.uuid(), input.get("requestId"), actor.id(),
                        action, target, input.get("reason"), json.writeValueAsString(stored), System.currentTimeMillis());
                return Map.of("accepted", true);
            });
        }

    public static Map<String, Object> validateMutation(JsonNode body, String kind) {
            Set<String> expected = switch (kind) {
                case "user" -> Set.of("requestId", "reason", "role", "disabled");
                case "quota" -> Set.of("requestId", "reason", "seconds", "delta");
                default -> Set.of("requestId", "reason", "version", "paused", "enabled", "zh", "en");
            };
            Set<String> fields = new java.util.LinkedHashSet<>();
            body.propertyNames().forEach(fields::add);
            if (kind.equals("settings")) {
                if (!expected.containsAll(fields) || !fields.containsAll(Set.of("requestId", "reason", "version"))) {
                    throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                }
            } else if (!fields.equals(expected)) {
                throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
            }
            JsonNode requestId = body.get("requestId"), reason = body.get("reason");
            if (!requestId.isString() || !reason.isString()) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
            if (!MigrationSupport.isUuid(requestId.asString()) || reason.asString().strip().length() < 3
                    || reason.asString().length() > 200) {
                throw new BusinessFailure("INVALID_REQUEST", INVALID_MUTATION, 400);
            }
            Map<String, Object> input = new LinkedHashMap<>();
            input.put("requestId", requestId.asString());
            input.put("reason", reason.asString());
            switch (kind) {
                case "user" -> {
                    JsonNode role = body.get("role"), disabled = body.get("disabled");
                    if (!role.isString() || !Set.of("user", "admin").contains(role.asString()) || !disabled.isBoolean()) {
                        throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                    }
                    input.put("role", role.asString());
                    input.put("disabled", disabled.asBoolean());
                }
                case "quota" -> {
                    JsonNode seconds = body.get("seconds"), delta = body.get("delta");
                    if (!seconds.isIntegralNumber() || !List.of(15, 30, 60).contains(seconds.asInt())
                            || !delta.isIntegralNumber() || delta.asLong() < -1_000_000 || delta.asLong() > 1_000_000) {
                        throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                    }
                    input.put("seconds", seconds.asInt());
                    input.put("delta", delta.asInt());
                }
                default -> {
                    JsonNode version = body.get("version"), paused = body.get("paused"),
                            enabled = body.get("enabled"), zh = body.get("zh"), en = body.get("en");
                    if (!version.isIntegralNumber() || version.asLong() < 0) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                    Map<String, Object> pausedValue = null;
                    if (paused != null && !paused.isNull()) {
                        Set<String> keys = new java.util.LinkedHashSet<>();
                        paused.propertyNames().forEach(keys::add);
                        if (!keys.equals(Set.of("studio", "video", "prompt"))) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                        pausedValue = new LinkedHashMap<>();
                        for (String scene : List.of("studio", "video", "prompt")) {
                            JsonNode item = paused.get(scene);
                            if (!item.isBoolean()) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                            pausedValue.put(scene, item.asBoolean());
                        }
                    }
                    Boolean enabledValue = null;
                    if (enabled != null && !enabled.isNull()) {
                        if (!enabled.isBoolean()) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
                        enabledValue = enabled.asBoolean();
                    }
                    input.put("version", version.asInt());
                    input.put("paused", pausedValue);
                    input.put("enabled", enabledValue);
                    input.put("zh", text(zh, 240));
                    input.put("en", text(en, 400));
                }
            }
            return input;
        }

    private static String text(JsonNode node, int maximum) {
            if (node == null || node.isNull()) return null;
            if (!node.isString() || node.asString().length() > maximum) throw new BusinessFailure("INVALID_REQUEST", INVALID, 400);
            return node.asString();
        }

    private record Setting(Map<String, Object> value, int version) {}

    private Setting setting(String key) {
            var rows = jdbc.queryForList("SELECT value,version FROM " + schema + "admin_settings WHERE key=?", key);
            if (rows.isEmpty()) return new Setting(Map.of(), 0);
            var row = rows.getFirst();
            Map<String, Object> value;
            try {
                value = json.readValue((String) row.get("value"), Map.class);
            } catch (RuntimeException error) {
                throw BusinessFailure.unavailable();
            }
            if (value == null) throw BusinessFailure.unavailable();
            return new Setting(value, (int) MigrationSupport.number(row, "version"));
        }

    private boolean paused(String scene) {
            return Boolean.TRUE.equals(setting("services").value().get(scene));
        }

    private static Map<String, Object> announcementView(Setting value) {
            boolean enabled = Boolean.TRUE.equals(value.value().get("enabled"));
            return MigrationSupport.body("version", value.version(), "enabled", enabled,
                    "zh", enabled ? String.valueOf(value.value().getOrDefault("zh", "")) : "",
                    "en", enabled ? String.valueOf(value.value().getOrDefault("en", "")) : "");
        }

    private List<Map<String, Object>> durations(String userId) {
            List<Map<String, Object>> rows = jdbc.queryForList("SELECT seconds,sum(total-revoked) AS quota,"
                    + "sum(total-reserved-used-revoked) AS remaining FROM " + schema
                    + "entitlement_grants WHERE user_id=? AND environment='real_usage' GROUP BY seconds", userId);
            List<Map<String, Object>> result = new ArrayList<>();
            for (int seconds : List.of(15, 30, 60)) {
                var row = rows.stream().filter(item -> MigrationSupport.number(item, "seconds") == seconds)
                        .findFirst().orElse(Map.of());
                result.add(MigrationSupport.body("seconds", seconds, "limit", MigrationSupport.number(row, "quota"),
                        "remaining", MigrationSupport.number(row, "remaining")));
            }
            return result;    }

    private int count(String sql, Object... args) {
            Integer value = jdbc.queryForObject(sql, Integer.class, args);
            return value == null ? 0 : value;
        }

    private static Object[] concat(List<Object> args, Object last) {
            List<Object> all = new ArrayList<>(args);
            all.add(last);
            return all.toArray();
        }

    private static String escape(String value) {
            return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        }
}
