package cn.yingxiang.bootstrap;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

/** M15：本机私有卷；UUID路径、拒绝符号链接、临时文件＋fsync＋原子替换。 */
@Service
@Profile("local")
public class LocalPrivateStorage implements StoragePort {
    private final Path root;

    public LocalPrivateStorage(Environment env) {
        String value = env.getRequiredProperty("migration.storage-root");
        Path path = Path.of(value);
        if (!path.isAbsolute()) throw new IllegalStateException("Storage root must be absolute");
        try {
            Files.createDirectories(path);
        } catch (IOException error) {
            throw new IllegalStateException("Storage root unavailable");
        }
        if (Files.isSymbolicLink(path) || !Files.isDirectory(path)) throw new IllegalStateException("Storage root invalid");
        root = path.toAbsolutePath().normalize();
    }

    @Override public Path directory(String userId, String workId) {
        if (!MigrationSupport.isUuid(userId) || !MigrationSupport.isUuid(workId)) {
            throw new BusinessFailure("WORK_NOT_FOUND", "找不到这件作品。", 404);
        }
        Path user = root.resolve(userId), parent = user.resolve("works"), path = parent.resolve(workId);
        for (Path item : new Path[]{user, parent, path}) {
            if (Files.isSymbolicLink(item)) throw new BusinessFailure("STORAGE_UNAVAILABLE", "作品目录不可用。", 503);
        }
        if (!path.normalize().startsWith(root)) throw new BusinessFailure("WORK_NOT_FOUND", "找不到这件作品。", 404);
        return path;
    }

    @Override public void writeAtomic(Path path, byte[] data) throws IOException {
        Path parent = path.getParent();
        Files.createDirectories(parent);
        if (Files.isSymbolicLink(parent) || Files.isSymbolicLink(path)) throw new IOException("unsafe path");
        Path temporary = parent.resolve(".tmp-" + UUID.randomUUID());
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                channel.write(java.nio.ByteBuffer.wrap(data));
                channel.force(true);
            }
            Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    @Override public byte[] read(Path path) throws IOException { return Files.readAllBytes(path); }

    @Override public boolean exists(Path path) { return Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS); }

    @Override public long size(Path path) throws IOException { return Files.size(path); }

    @Override public void delete(Path path) throws IOException { Files.deleteIfExists(path); }
}
