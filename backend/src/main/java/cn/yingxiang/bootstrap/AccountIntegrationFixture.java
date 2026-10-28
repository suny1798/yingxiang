package cn.yingxiang.bootstrap;

import tools.jackson.databind.json.JsonMapper;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/** 仅测试CLI：必须随机临时schema和所有权标记，绝不操作正式迁移schema。 */
public final class AccountIntegrationFixture {
    private AccountIntegrationFixture() {}

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        java.util.logging.Logger.getLogger("").setLevel(java.util.logging.Level.OFF);
        var json = JsonMapper.builder().build();
        Map<String, Object> report = new LinkedHashMap<>();
        int exit = 1;
        try {
            if (args.length != 3 || !args[2].matches("yingxiang_migration_it_[a-f0-9]{12}")) throw new IllegalArgumentException();
            String action = args[0], target = args[2];
            Properties config = ConnectionProbe.load(Path.of(args[1]));
            ConnectionProbe.validate(config); config.setProperty("migration.db-schema", target);
            if (action.equals("setup")) {
                if (Boolean.TRUE.equals(SchemaOperations.preflight(config).get("schemaExists"))) throw new IllegalStateException();
                var flyway = SchemaOperations.flyway(config);
                report.put("migrationsExecuted", flyway.migrate().migrationsExecuted);
                report.put("repeatMigrationsExecuted", flyway.migrate().migrationsExecuted);
                if (!flyway.validateWithResult().validationSuccessful) throw new IllegalStateException();
                Map<String, Object> body = json.readValue(System.in, Map.class);
                try (var connection = SchemaOperations.dataSource(config, false).getConnection()) {
                    connection.setAutoCommit(false);
                    try (var statement = connection.createStatement()) {
                        statement.execute("COMMENT ON SCHEMA \"" + target + "\" IS 'yingxiang-m10b-integration:" + target + "'");
                    }
                    Map<String, List<Map<String, Object>>> tables = (Map<String, List<Map<String, Object>>>) body.get("tables");
                    for (var table : tables.entrySet()) {
                        if (!Set.of("users", "auth_sessions", "entitlement_grants", "usage_attempts",
                                "orders", "payment_events", "sandbox_credit_packs", "admin_audit", "admin_settings",
                                "works", "work_references", "video_jobs", "video_history",
                                "budget_campaigns", "budget_reservations", "scene_access", "auth_rate_limits").contains(table.getKey())) throw new IllegalArgumentException();
                        for (Map<String, Object> row : table.getValue()) {
                            List<String> columns = new ArrayList<>(row.keySet());
                            if (columns.stream().anyMatch(column -> !column.matches("[a-z_]+"))) throw new IllegalArgumentException();
                            String sql = "INSERT INTO " + table.getKey() + " (" + String.join(",", columns) + ") VALUES ("
                                    + String.join(",", java.util.Collections.nCopies(columns.size(), "?")) + ")";
                            try (var statement = connection.prepareStatement(sql)) {
                                for (int i = 0; i < columns.size(); i++) statement.setObject(i + 1, row.get(columns.get(i)));
                                statement.executeUpdate();
                            }
                        }
                    }
                    connection.commit();
                    report.put("constraintRejections", constraintChecks(connection));
                    report.put("columns", columns(connection, target));
                }
            } else {
                try (var connection = SchemaOperations.dataSource(config, false).getConnection()) {
                    try (var statement = connection.prepareStatement("SELECT obj_description(oid,'pg_namespace') FROM pg_namespace WHERE nspname=?")) {
                        statement.setString(1, target);
                        try (var rows = statement.executeQuery()) {
                            if (!rows.next() || !("yingxiang-m10b-integration:" + target).equals(rows.getString(1))) throw new IllegalStateException();
                        }
                    }
                    if (action.equals("cleanup")) {
                        try (var statement = connection.createStatement()) { statement.execute("DROP SCHEMA \"" + target + "\" CASCADE"); }
                    } else if (action.equals("quota-reserve") || action.equals("quota-confirm")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        var dataSource = SchemaOperations.dataSource(config, false);
                        var env = new org.springframework.core.env.StandardEnvironment();
                        env.getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("quota-fixture", Map.of("migration.db-schema", target)));
                        var service = new EntitlementReservationService(new org.springframework.jdbc.core.JdbcTemplate(dataSource),
                                new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource), env);
                        if (action.equals("quota-reserve")) {
                            service.reserve((String) body.get("hashed"), (String) body.get("attemptId"), ((Number) body.get("seconds")).intValue());
                        } else report.put("transitionApplied", service.confirmIssued((String) body.get("attemptId")));
                    } else if (action.equals("studio-setting")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        if (!(body.get("paused") instanceof Boolean)) throw new IllegalArgumentException();
                        try (var query = connection.prepareStatement("INSERT INTO admin_settings(key,value,version) VALUES ('services',?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=admin_settings.version+1")) {
                            query.setString(1, json.writeValueAsString(Map.of("studio", body.get("paused")))); query.executeUpdate();
                        }
                    } else if (action.equals("studio-attempt")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        try (var query = connection.prepareStatement("SELECT state,account_state,observation,outcome FROM usage_attempts WHERE id=? AND scene='studio'")) {
                            query.setString(1, (String) body.get("attemptId"));
                            try (var rows = query.executeQuery()) {
                                if (!rows.next()) throw new IllegalArgumentException();
                                var attempt = new LinkedHashMap<String, Object>();
                                attempt.put("state", rows.getString(1)); attempt.put("accountState", rows.getString(2));
                                attempt.put("observation", rows.getString(3) == null ? null : json.readValue(rows.getString(3), Map.class));
                                attempt.put("outcome", rows.getString(4)); report.put("attempt", attempt);
                            }
                        }
                    } else if (action.equals("quota-state")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        String username = String.valueOf(body.get("username"));
                        List<Map<String, Object>> grants = new ArrayList<>(), attempts = new ArrayList<>(), entries = new ArrayList<>();
                        try (var query = connection.prepareStatement("SELECT g.id,g.seconds,g.environment,g.total,g.reserved,g.used,g.revoked FROM entitlement_grants g JOIN users u ON u.id=g.user_id WHERE u.username=? ORDER BY g.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) grants.add(Map.of("id", rows.getString(1), "seconds", rows.getInt(2), "environment", rows.getString(3),
                                        "total", rows.getInt(4), "reserved", rows.getInt(5), "used", rows.getInt(6), "revoked", rows.getInt(7)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT a.id,a.seconds,a.state,a.account_state FROM usage_attempts a JOIN users u ON u.id=a.user_id WHERE u.username=? ORDER BY a.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) attempts.add(Map.of("id", rows.getString(1), "seconds", rows.getInt(2), "state", rows.getString(3), "accountState", rows.getString(4)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT e.operation_key,e.kind,e.quantity FROM entitlement_entries e JOIN entitlement_grants g ON g.id=e.grant_id JOIN users u ON u.id=g.user_id WHERE u.username=? ORDER BY e.operation_key")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) entries.add(Map.of("operationKey", rows.getString(1), "kind", rows.getString(2), "quantity", rows.getInt(3)));
                            }
                        }
                        report.put("grants", grants); report.put("attempts", attempts); report.put("entries", entries);
                    } else if (action.equals("stats")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        String username = String.valueOf(body.getOrDefault("username", ""));
                        try (var query = connection.prepareStatement("SELECT (SELECT count(*) FROM users WHERE username=lower(?)), "
                                + "(SELECT count(*) FROM entitlement_grants g JOIN users u ON u.id=g.user_id WHERE u.username=lower(?) AND g.source='free'), "
                                + "(SELECT count(*) FROM entitlement_entries e JOIN entitlement_grants g ON e.grant_id=g.id JOIN users u ON u.id=g.user_id WHERE u.username=lower(?)), "
                                + "(SELECT count(*) FROM auth_sessions s JOIN users u ON s.user_id=u.id WHERE u.username=lower(?)), "
                                + "coalesce((SELECT count FROM auth_rate_limits WHERE key='auth:global'),0), "
                                + "coalesce((SELECT count FROM auth_rate_limits WHERE key=?),0)")) {
                            for (int i = 1; i <= 4; i++) query.setString(i, username);
                            query.setString(5, "auth:" + username.toLowerCase(java.util.Locale.ROOT));
                            try (var rows = query.executeQuery()) {
                                rows.next();
                                for (int i = 0; i < 6; i++) report.put(List.of("users", "freeGrants", "entries", "sessions", "globalCount", "userCount").get(i), rows.getLong(i + 1));
                            }
                        }
                    } else if (action.equals("expire-limit")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        try (var query = connection.prepareStatement("UPDATE auth_rate_limits SET until=0 WHERE key=?")) {
                            query.setString(1, "auth:" + String.valueOf(body.get("username")).toLowerCase(java.util.Locale.ROOT)); query.executeUpdate();
                        }
                    } else if (action.equals("fail-free-grant") || action.equals("fail-consume")) {
                        try (var statement = connection.createStatement()) {
                            statement.execute("CREATE FUNCTION reject_test_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END; $$");
                            statement.execute("CREATE TRIGGER reject_test_grant BEFORE INSERT ON entitlement_entries FOR EACH ROW "
                                    + (action.equals("fail-consume") ? "WHEN (NEW.kind='consume') " : "") + "EXECUTE FUNCTION reject_test_grant()");
                        }
                    } else if (action.equals("restore-free-grant")) {
                        try (var statement = connection.createStatement()) {
                            statement.execute("DROP TRIGGER reject_test_grant ON entitlement_entries"); statement.execute("DROP FUNCTION reject_test_grant()");
                        }
                    } else if (Set.of("disable", "promote", "expire", "revoke", "drop-sessions-table").contains(action)) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        String userId = (String) body.get("userId");
                        String sql = switch (action) {
                            case "disable" -> "UPDATE users SET disabled=1 WHERE id=?";
                            case "promote" -> "UPDATE users SET role='admin' WHERE id=?";
                            case "expire" -> "UPDATE auth_sessions SET expires_at=0 WHERE user_id=?";
                            case "revoke" -> "DELETE FROM auth_sessions WHERE user_id=?";
                            default -> "";
                        };
                        if (action.equals("drop-sessions-table")) {
                            try (var statement = connection.createStatement()) { statement.execute("DROP TABLE auth_sessions"); }
                        } else {
                            try (var statement = connection.prepareStatement(sql)) { statement.setString(1, userId); statement.executeUpdate(); }
                        }
                    } else if (action.equals("payments-state")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        String username = String.valueOf(body.get("username"));
                        List<Map<String, Object>> orders = new ArrayList<>(), grants = new ArrayList<>(),
                                entries = new ArrayList<>(), packs = new ArrayList<>(), events = new ArrayList<>();
                        try (var query = connection.prepareStatement("SELECT o.id,o.sku,o.plan_id,o.seconds,o.count,o.amount,o.currency,"
                                + "o.state,o.session_id,o.checkout_url,o.expires_at,o.fulfilled_at,o.request_snapshot,o.created_at "
                                + "FROM orders o JOIN users u ON u.id=o.user_id WHERE u.username=? ORDER BY o.created_at,o.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) {
                                    var item = new LinkedHashMap<String, Object>();
                                    item.put("id", rows.getString("id")); item.put("sku", rows.getString("sku"));
                                    item.put("planId", rows.getString("plan_id")); item.put("seconds", rows.getObject("seconds"));
                                    item.put("count", rows.getObject("count")); item.put("amount", rows.getInt("amount"));
                                    item.put("currency", rows.getString("currency")); item.put("state", rows.getString("state"));
                                    item.put("sessionId", rows.getString("session_id")); item.put("checkoutUrl", rows.getString("checkout_url"));
                                    item.put("expiresAt", rows.getObject("expires_at")); item.put("fulfilledAt", rows.getObject("fulfilled_at"));
                                    item.put("requestSnapshot", rows.getString("request_snapshot")); item.put("createdAt", rows.getLong("created_at"));
                                    orders.add(item);
                                }
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT g.id,g.seconds,g.environment,g.source,g.source_key,g.total,g.reserved,g.used,g.revoked "
                                + "FROM entitlement_grants g JOIN users u ON u.id=g.user_id WHERE u.username=? ORDER BY g.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) grants.add(Map.of("id", rows.getString(1), "seconds", rows.getInt(2),
                                        "environment", rows.getString(3), "source", rows.getString(4), "sourceKey", rows.getString(5),
                                        "total", rows.getInt(6), "reserved", rows.getInt(7), "used", rows.getInt(8), "revoked", rows.getInt(9)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT e.operation_key,e.kind,e.quantity FROM entitlement_entries e "
                                + "JOIN entitlement_grants g ON g.id=e.grant_id JOIN users u ON u.id=g.user_id WHERE u.username=? ORDER BY e.operation_key")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) entries.add(Map.of("operationKey", rows.getString(1), "kind", rows.getString(2), "quantity", rows.getInt(3)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT p.order_id,p.plan_id,p.credits,p.scenes,p.created_at FROM sandbox_credit_packs p "
                                + "JOIN users u ON u.id=p.user_id WHERE u.username=? ORDER BY p.created_at,p.order_id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) packs.add(Map.of("orderId", rows.getString(1), "planId", rows.getString(2),
                                        "credits", rows.getInt(3), "scenes", rows.getString(4), "createdAt", rows.getLong(5)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT e.id,e.order_id,e.source,e.created_at FROM payment_events e "
                                + "JOIN orders o ON o.id=e.order_id JOIN users u ON u.id=o.user_id WHERE u.username=? ORDER BY e.created_at,e.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) events.add(Map.of("id", rows.getString(1), "orderId", rows.getString(2),
                                        "source", rows.getString(3), "createdAt", rows.getLong(4)));
                            }
                        }
                        report.put("orders", orders); report.put("grants", grants); report.put("entries", entries);
                        report.put("packs", packs); report.put("events", events);
                    } else if (action.equals("admin-state")) {
                        Map<String, Object> body = json.readValue(System.in, Map.class);
                        String username = String.valueOf(body.get("username"));
                        List<Map<String, Object>> users = new ArrayList<>(), audit = new ArrayList<>(),
                                settings = new ArrayList<>(), grants = new ArrayList<>(), entries = new ArrayList<>();
                        try (var query = connection.prepareStatement("SELECT id,username,role,disabled FROM users ORDER BY username")) {
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) users.add(Map.of("id", rows.getString(1), "username", rows.getString(2),
                                        "role", rows.getString(3), "disabled", rows.getInt(4)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT request_id,actor_id,action,target,reason,changes,created_at "
                                + "FROM admin_audit ORDER BY created_at,id")) {
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) audit.add(Map.of("requestId", rows.getString(1), "actorId", rows.getString(2),
                                        "action", rows.getString(3), "target", rows.getString(4), "reason", rows.getString(5),
                                        "changes", rows.getString(6), "createdAt", rows.getLong(7)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT key,value,version FROM admin_settings ORDER BY key")) {
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) settings.add(Map.of("key", rows.getString(1), "value", rows.getString(2), "version", rows.getInt(3)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT g.id,g.seconds,g.total,g.reserved,g.used,g.revoked FROM entitlement_grants g "
                                + "JOIN users u ON u.id=g.user_id WHERE u.username=? AND g.environment='real_usage' ORDER BY g.id")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) grants.add(Map.of("id", rows.getString(1), "seconds", rows.getInt(2), "total", rows.getInt(3),
                                        "reserved", rows.getInt(4), "used", rows.getInt(5), "revoked", rows.getInt(6)));
                            }
                        }
                        try (var query = connection.prepareStatement("SELECT e.operation_key,e.kind,e.quantity FROM entitlement_entries e "
                                + "JOIN entitlement_grants g ON g.id=e.grant_id JOIN users u ON u.id=g.user_id WHERE u.username=? ORDER BY e.operation_key")) {
                            query.setString(1, username);
                            try (var rows = query.executeQuery()) {
                                while (rows.next()) entries.add(Map.of("operationKey", rows.getString(1), "kind", rows.getString(2), "quantity", rows.getInt(3)));
                            }
                        }
                        report.put("users", users); report.put("audit", audit); report.put("settings", settings);
                        report.put("grants", grants); report.put("entries", entries);
                    } else throw new IllegalArgumentException();
                }
            }
            report.put("status", "OK"); exit = 0;
        } catch (BusinessFailure error) {
            report.clear(); report.put("status", "DOMAIN_REJECTED"); report.put("code", error.code); report.put("httpStatus", error.status); report.put("message", error.getMessage()); exit = 2;
        } catch (Exception error) {
            report.clear(); report.put("status", "FIXTURE_FAILED"); report.put("code", ConnectionProbe.failureCode(error));
        }
        System.out.writeBytes((json.writeValueAsString(report) + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8)); System.exit(exit);
    }

    private static int constraintChecks(Connection connection) throws SQLException {
        String userId;
        try (var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT id FROM users ORDER BY username LIMIT 1")) { rows.next(); userId = rows.getString(1); }
        if (!userId.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException();
        List<String> statements = List.of(
                "INSERT INTO users(id,username,salt,password_hash,created_at) SELECT 'duplicate-user',username,'synthetic','synthetic',0 FROM users LIMIT 1",
                "INSERT INTO entitlement_grants(id,user_id,seconds,environment,source,source_key,total,reserved) VALUES ('invalid-balance','" + userId + "',15,'real_usage','test','invalid-balance',1,2)",
                "INSERT INTO auth_sessions(hash,user_id,expires_at) VALUES ('invalid-fk','missing-user',0)");
        List<String> expected = List.of("23505", "23514", "23503");
        for (int i = 0; i < statements.size(); i++) {
            var savepoint = connection.setSavepoint();
            boolean rejected = false;
            try (var statement = connection.createStatement()) { statement.executeUpdate(statements.get(i)); }
            catch (SQLException error) { rejected = expected.get(i).equals(error.getSQLState()); }
            finally { connection.rollback(savepoint); }
            if (!rejected) throw new IllegalStateException("Constraint not enforced");
        }
        connection.rollback();
        return statements.size();
    }

    private static Map<String, List<String>> columns(Connection connection, String target) throws SQLException {
        Map<String, List<String>> result = new LinkedHashMap<>();
        try (var query = connection.prepareStatement("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=? AND table_name<>'flyway_schema_history' ORDER BY table_name,ordinal_position")) {
            query.setString(1, target);
            try (var rows = query.executeQuery()) {
                while (rows.next()) result.computeIfAbsent(rows.getString(1), ignored -> new ArrayList<>()).add(rows.getString(2));
            }
        }
        return result;
    }
}
