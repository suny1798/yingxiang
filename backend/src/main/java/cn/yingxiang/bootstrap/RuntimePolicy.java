package cn.yingxiang.bootstrap;

import java.net.URI;
import java.util.Set;
import org.springframework.core.env.Environment;

/** 正式运行只允许固定供应商；默认隔离模式不允许外部出口。 */
final class RuntimePolicy {
    static boolean runtime(Environment env) { return env.getProperty("migration.runtime-enabled", Boolean.class, false); }
    static void endpoint(URI uri, String host, String path, boolean runtime) {
        boolean safe = uri.getUserInfo()==null && uri.getQuery()==null && uri.getFragment()==null;
        boolean allowed = runtime
            ? "https".equals(uri.getScheme()) && host.equals(uri.getHost()) && (uri.getPort()==-1 || uri.getPort()==443) && path.equals(uri.getPath())
            : "http".equals(uri.getScheme()) && Set.of("127.0.0.1", "localhost", "::1").contains(uri.getHost()==null ? "" : uri.getHost());
        if (!safe || !allowed) throw new IllegalArgumentException("Provider endpoint rejected");
    }
    static void tokenKey(String key, boolean runtime) {
        if (key==null || (runtime ? !key.matches("dct_[A-Za-z0-9_-]{8,}") : !key.matches("synthetic-[A-Za-z0-9-]{1,118}")))
            throw new IllegalArgumentException("Invalid provider credential");
    }
}
