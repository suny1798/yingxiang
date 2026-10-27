package cn.yingxiang.bootstrap;

import org.flywaydb.core.Flyway;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/** 仅显式运维调用；API启动不使用此入口。 */
public final class SchemaOperations {
    private SchemaOperations() {}

    public static String schema(Properties config) {
        String value = config.getProperty("migration.db-schema", "");
        if (!value.matches("yingxiang_migration(?:_it_[a-f0-9]{12})?")) throw new IllegalArgumentException();
        return value;
    }

    public static DriverManagerDataSource dataSource(Properties config, boolean readOnly) {
        var source = new DriverManagerDataSource();
        source.setUrl(config.getProperty("spring.datasource.url"));
        source.setUsername(config.getProperty("spring.datasource.username"));
        source.setPassword(config.getProperty("spring.datasource.password"));
        Properties properties = ConnectionProbe.jdbcProperties(config);
        properties.setProperty("readOnly", Boolean.toString(readOnly));
        properties.setProperty("currentSchema", schema(config));
        source.setConnectionProperties(properties);
        return source;
    }

    public static Flyway flyway(Properties config) {
        String target = schema(config);
        return Flyway.configure().dataSource(dataSource(config, false)).defaultSchema(target).schemas(target)
                .locations("classpath:db/migration").createSchemas(true).cleanDisabled(true)
                .baselineOnMigrate(false).validateOnMigrate(true).validateMigrationNaming(true)
                .connectRetries(0).load();
    }

    public static Map<String, Object> preflight(Properties config) throws Exception {
        String target = schema(config);
        var result = new LinkedHashMap<String, Object>();
        try (var connection = DriverManager.getConnection(config.getProperty("spring.datasource.url"), ConnectionProbe.jdbcProperties(config));
             var query = connection.prepareStatement("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=?), "
                     + "has_database_privilege(current_user,current_database(),'CREATE'), "
                     + "(SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=?), "
                     + "to_regclass(?) IS NOT NULL, "
                     + "(SELECT count(*) FROM information_schema.tables WHERE table_schema='public')")) {
            query.setString(1, target); query.setString(2, target);
            query.setString(3, target + ".flyway_schema_history"); query.setQueryTimeout(5);
            try (var rows = query.executeQuery()) {
                rows.next();
                result.put("schemaExists", rows.getBoolean(1));
                result.put("databaseCreateSchema", rows.getBoolean(2));
                result.put("objectCount", rows.getLong(3));
                result.put("hasHistory", rows.getBoolean(4));
                result.put("publicTableCount", rows.getLong(5));
            }
        }
        return result;
    }

    public static void main(String[] args) {
        java.util.logging.Logger.getLogger("").setLevel(java.util.logging.Level.OFF);
        Map<String, Object> report = new LinkedHashMap<>();
        int exit = 1;
        try {
            if (args.length != 2 || !Set.of("preflight", "migrate", "validate").contains(args[0])) throw new IllegalArgumentException();
            Properties config = ConnectionProbe.load(Path.of(args[1]));
            ConnectionProbe.validate(config);
            report.put("action", args[0]);
            report.putAll(preflight(config));
            if (args[0].equals("preflight")) {
                report.put("status", "PREFLIGHT_COMPLETE"); exit = 0;
            } else if (Boolean.TRUE.equals(report.get("schemaExists"))
                    && ((Number) report.get("objectCount")).longValue() > 0 && !Boolean.TRUE.equals(report.get("hasHistory"))) {
                report.put("status", "UNKNOWN_NONEMPTY_SCHEMA");
            } else if (args[0].equals("validate") && !Boolean.TRUE.equals(report.get("hasHistory"))) {
                report.put("status", "SCHEMA_NOT_MIGRATED");
            } else {
                Flyway flyway = flyway(config);
                if (args[0].equals("migrate")) report.put("migrationsExecuted", flyway.migrate().migrationsExecuted);
                var validation = flyway.validateWithResult();
                report.put("status", validation.validationSuccessful ? "VALIDATED" : "VALIDATION_FAILED");
                report.put("pendingMigrations", flyway.info().pending().length);
                report.put("flywayVersion", Flyway.class.getPackage().getImplementationVersion());
                report.putAll(preflight(config));
                exit = validation.validationSuccessful && flyway.info().pending().length == 0 ? 0 : 1;
            }
        } catch (Exception error) {
            report.put("status", "OPERATION_FAILED");
            report.put("code", ConnectionProbe.failureCode(error));
        }
        System.out.println(JsonMapper.builder().build().writeValueAsString(report));
        System.exit(exit);
    }
}
