package cn.yingxiang.manager;

import cn.yingxiang.common.MigrationSupport;
import cn.yingxiang.mapper.UploadMapper;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;

/** M19：上传全局槽由主库条件租约控制，Redis不是唯一互斥依据。 */
@Service
@Profile("local")
public class UploadGate {
    private final JdbcTemplate jdbc;
    private final UploadMapper uploads;
    private final TransactionTemplate transaction;
    private final String schema;

    public UploadGate(JdbcTemplate jdbc, UploadMapper uploads, PlatformTransactionManager manager, Environment env) {
        this.jdbc = jdbc; this.uploads = uploads;
        this.schema = MigrationSupport.quotedSchema(env);
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(5);
    }

    public Lease acquire(String id, String owner, long leaseMs) {
        long now = System.currentTimeMillis();
        Long generation = transaction.execute(status -> uploads.acquire(schema, id, owner, now + leaseMs, now));
        return generation == null ? null : new Lease(id, owner, generation);
    }

    public void release(Lease lease) {
        if (lease == null) return;
        uploads.release(schema, lease.id, lease.owner, lease.generation);
    }

    public final class Lease implements AutoCloseable {
        private final String id;
        private final String owner;
        private final long generation;
        private Lease(String id, String owner, long generation) {
            this.id = id; this.owner = owner; this.generation = generation;
        }
        @Override public void close() { release(this); }
    }
}
