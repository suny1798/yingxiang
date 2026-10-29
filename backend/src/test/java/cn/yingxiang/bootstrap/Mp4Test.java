package cn.yingxiang.bootstrap;

import cn.yingxiang.manager.Mp4;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class Mp4Test {
    private static byte[] asset() throws Exception {
        return Files.readAllBytes(Path.of("../frontend/public/assets/try-on-demo.mp4"));
    }

    @Test void inspectsTheCommittedSyntheticDemoVideo() throws Exception {
        byte[] data = asset();
        Mp4.Info info = Mp4.inspect(data, false);
        assertThat(info.seconds()).isBetween(1.0, 15.001);
        assertThat(info.width()).isBetween(320, 3840);
        assertThat(info.height()).isBetween(320, 3840);
        assertThat(info.hasAudio()).isFalse();
        Mp4.Prepared prepared = Mp4.prepare(data);
        assertThat(prepared.removed()).isFalse();
        assertThat(prepared.bytes()).isEqualTo(data);
        assertThat(prepared.info().seconds()).isEqualTo(info.seconds());
    }

    @Test void rejectsTruncatedOrForeignMedia() throws Exception {
        byte[] data = asset();
        assertThatThrownBy(() -> Mp4.inspect(new byte[64], false)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Mp4.inspect(java.util.Arrays.copyOf(data, data.length / 2), false))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Mp4.inspect("not an mp4 file at all, but long enough to pass length checks".getBytes(StandardCharsets.UTF_8), false))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void validatesStaticImageHeadersAndRejectsMismatches() {
        byte[] png = concat(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a},
                u32(13), "IHDR".getBytes(StandardCharsets.ISO_8859_1), u32(640), u32(480),
                new byte[]{8, 6, 0, 0, 0}, u32(0));
        Mp4.validateImage(png, "image/png");
        assertThatThrownBy(() -> Mp4.validateImage(png, "image/jpeg")).isInstanceOf(IllegalArgumentException.class);
        byte[] jpeg = concat(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xc0, 0, 8, 8, 0, 0x10, 0, 0x10, 0},
                new byte[]{(byte) 0xff, (byte) 0xd9});
        Mp4.validateImage(jpeg, "image/jpeg");
        byte[] webp = concat("RIFF".getBytes(StandardCharsets.ISO_8859_1), u32(18),
                "WEBP".getBytes(StandardCharsets.ISO_8859_1), "VP8L".getBytes(StandardCharsets.ISO_8859_1),
                u32(5), new byte[]{0x2f, 0, 0, 0, 0, 0});
        Mp4.validateImage(webp, "image/webp");
        assertThatThrownBy(() -> Mp4.validateImage(new byte[]{1, 2, 3}, "image/png"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static byte[] u32(long value) {
        return new byte[]{(byte) (value >>> 24), (byte) (value >>> 16), (byte) (value >>> 8), (byte) value};
    }

    private static byte[] concat(byte[]... values) {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        for (byte[] value : values) output.writeBytes(value);
        return output.toByteArray();
    }
}
