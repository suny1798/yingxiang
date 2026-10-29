package cn.yingxiang.bootstrap;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
final class RuntimeRole {
    @org.springframework.beans.factory.annotation.Autowired
    RuntimeRole(Environment env, org.springframework.beans.factory.ObjectProvider<Readiness> readiness) {
        this(env);
        if (RuntimePolicy.runtime(env) && !env.getProperty("migration.maintenance",Boolean.class,true)
                && (readiness.getIfAvailable()==null || !Boolean.TRUE.equals(readiness.getObject().check().get("ready"))))
            throw new IllegalStateException("Runtime database must be verified and sealed before writes");
    }
    RuntimeRole(Environment env) {
        String role = env.getProperty("migration.role", "api");
        if (RuntimePolicy.runtime(env)) {
            boolean scene=env.getProperty("migration.studio-enabled",Boolean.class,false)
                || env.getProperty("migration.video-enabled",Boolean.class,false) || env.getProperty("migration.prompt-enabled",Boolean.class,false);
            if ((scene && !env.getProperty("migration.scenes-enabled",Boolean.class,false))
                || ((scene || env.getProperty("migration.payments-enabled",Boolean.class,false) || role.equals("worker"))
                    && !env.getProperty("migration.allow-external-providers",Boolean.class,false)))
                throw new IllegalStateException("Explicit provider and scene gates required");
        }
        boolean worker = env.getProperty("migration.worker-enabled", Boolean.class, false);
        if (!(role.equals("api") || role.equals("worker")) || worker != role.equals("worker"))
            throw new IllegalStateException("API and Worker roles must be explicit and exclusive");
    }
}
