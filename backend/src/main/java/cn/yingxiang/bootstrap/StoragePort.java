package cn.yingxiang.bootstrap;

import java.io.IOException;
import java.nio.file.Path;

/** M15：私有媒体存储端口；本机卷实现，后续对象存储不改变业务合同。 */
public interface StoragePort {
    Path directory(String userId, String workId);
    void writeAtomic(Path path, byte[] data) throws IOException;
    byte[] read(Path path) throws IOException;
    boolean exists(Path path);
    long size(Path path) throws IOException;
    void delete(Path path) throws IOException;
}
