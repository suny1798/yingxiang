package cn.yingxiang.manager;

import cn.yingxiang.common.MigrationSupport;
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
    private final TransactionTemplate transaction;
    private final String schema;

    public UploadGate(JdbcTemplate jdbc, PlatformTransactionManager manager, Environment env) {
        this.jdbc = jdbc;
        this.schema = MigrationSupport.quotedSchema(env);
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transaction.setTimeout(5);
    }

    public Lease acquire(String id, String owner, long leaseMs) {
        long now = System.currentTimeMillis();
        Long generation = transaction.execute(status -> {
            List<Map<String, Object>> rows = jdbc.queryForList("INSERT INTO " + schema
                            + "upload_slots(id,owner,lease_generation,lease_until,updated_at) VALUES (?,?,1,?,?) "
                            + "ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,"
                            + "lease_generation=upload_slots.lease_generation+1,lease_until=excluded.lease_until,"
                            + "updated_at=excluded.updated_at WHERE upload_slots.lease_until<? "
                            + "RETURNING lease_generation",
                    id, owner, now + leaseMs, now, now);
            return rows.isEmpty() ? null : MigrationSupport.number(rows.getFirst(), "lease_generation");
        });
        return generation == null ? null : new Lease(id, owner, generation);
    }

    public void release(Lease lease) {
        if (lease == null) return;
        jdbc.update("DELETE FROM " + schema + "upload_slots WHERE id=? AND owner=? AND lease_generation=?",
                lease.id, lease.owner, lease.generation);
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
