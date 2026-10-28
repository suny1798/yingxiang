package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LocalPrivateStorageTest {
    @TempDir Path temporary;

    private LocalPrivateStorage storage() {
        MockEnvironment env = new MockEnvironment().withProperty("migration.storage-root", temporary.toString());
        return new LocalPrivateStorage(env);
    }

    @Test void writesAtomicallyInsideUuidDirectories() throws Exception {
        LocalPrivateStorage storage = storage();
        String user = UUID.randomUUID().toString(), work = UUID.randomUUID().toString();
        Path directory = storage.directory(user, work);
        assertThat(directory.startsWith(temporary.toAbsolutePath().normalize())).isTrue();
        storage.writeAtomic(directory.resolve("chunk-000000"), "synthetic".getBytes(StandardCharsets.UTF_8));
        assertThat(storage.exists(directory.resolve("chunk-000000"))).isTrue();
        assertThat(new String(storage.read(directory.resolve("chunk-000000")), StandardCharsets.UTF_8)).isEqualTo("synthetic");
        storage.writeAtomic(directory.resolve("chunk-000000"), "replaced".getBytes(StandardCharsets.UTF_8));
        assertThat(new String(storage.read(directory.resolve("chunk-000000")), StandardCharsets.UTF_8)).isEqualTo("replaced");
        assertThat(Files.list(directory).filter(path -> path.getFileName().toString().startsWith(".tmp-")).count()).isZero();
        storage.delete(directory.resolve("chunk-000000"));
        assertThat(storage.exists(directory.resolve("chunk-000000"))).isFalse();
    }

    @Test void rejectsTraversalAndRequiresAbsoluteRoot() {
        LocalPrivateStorage storage = storage();
        for (String value : new String[]{"..", "../etc", "not-a-uuid"}) {
            assertThatThrownBy(() -> storage.directory(value, UUID.randomUUID().toString()))
                    .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("WORK_NOT_FOUND"));
            assertThatThrownBy(() -> storage.directory(UUID.randomUUID().toString(), value))
                    .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("WORK_NOT_FOUND"));
        }
        assertThatThrownBy(() -> new LocalPrivateStorage(new MockEnvironment().withProperty("migration.storage-root", "relative/path")))
                .isInstanceOf(IllegalStateException.class);
    }
}
