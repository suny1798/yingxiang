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
                        if (!Set.of("users", "auth_sessions", "entitlement_grants", "usage_attempts").contains(table.getKey())) throw new IllegalArgumentException();
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
                    } else throw new IllegalArgumentException();
                }
            }
            report.put("status", "OK"); exit = 0;
        } catch (Exception error) {
            report.clear(); report.put("status", "FIXTURE_FAILED"); report.put("code", ConnectionProbe.failureCode(error));
        }
        System.out.println(json.writeValueAsString(report)); System.exit(exit);
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
