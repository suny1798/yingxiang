package cn.yingxiang.manager;

import java.io.IOException;
import java.nio.file.Path;

/** M15：私有媒体存储端口；本机卷实现，后续对象存储不改变业务合同。 */
public interface StoragePort {
    public Path directory(String userId, String workId);
    public void writeAtomic(Path path, byte[] data) throws IOException;
    public byte[] read(Path path) throws IOException;
    public boolean exists(Path path);
    public long size(Path path) throws IOException;
    public void delete(Path path) throws IOException;
}
