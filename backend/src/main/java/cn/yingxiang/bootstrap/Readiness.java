package cn.yingxiang.bootstrap;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 只读探针；不迁移、不建库、不调用供应商。Redis故障不阻断已提交任务收尾。 */
@Component
@Profile("local")
final class Readiness {
    private final DataSource source;
    private final Environment env;
    Readiness(DataSource source, Environment env) { this.source=source; this.env=env; }
    Map<String,Object> check() {
        try {
            JdbcTemplate jdbc=new JdbcTemplate(source);
            jdbc.setQueryTimeout(3);
            String schema=env.getRequiredProperty("migration.db-schema");
            String prefix=MigrationSupport.quotedSchema(env);
            if (!Integer.valueOf(1).equals(jdbc.queryForObject("SELECT 1", Integer.class))) throw new IllegalStateException();
            Flyway flyway=Flyway.configure().dataSource(source).defaultSchema(schema).schemas(schema)
                .cleanDisabled(true).baselineOnMigrate(false).load();
            flyway.validate();
            if (flyway.info().pending().length!=0) throw new IllegalStateException();
            if (RuntimePolicy.runtime(env) && !Integer.valueOf(1).equals(jdbc.queryForObject(
                "SELECT count(*) FROM " + prefix + "import_batches WHERE status='sealed'", Integer.class))) throw new IllegalStateException();
            if (env.getProperty("migration.works-enabled", Boolean.class, false)
                    || env.getProperty("migration.worker-enabled", Boolean.class, false)) {
                Path root=Path.of(env.getRequiredProperty("migration.storage-root"));
                if (!Files.isDirectory(root) || Files.isSymbolicLink(root) || !Files.isReadable(root) || !Files.isWritable(root))
                    throw new IllegalStateException();
            }
            return Map.of("ready",true,"role",env.getProperty("migration.role","api"),
                "maintenance",env.getProperty("migration.maintenance",Boolean.class,true));
        } catch (RuntimeException failure) {
            return Map.of("ready",false,"reason","DEPENDENCY_OR_SCHEMA_UNAVAILABLE");
        }
    }
}
