package cn.yingxiang.bootstrap;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MultipartTest {
    private static byte[] body(String boundary) {
        String head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"data\"; filename=\"person.mp4\"\r\n"
                + "Content-Type: video/mp4\r\n\r\n";
        String middle = "\r\n"
                + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"reference_image\"; filename=\"garment.png\"\r\n"
                + "Content-Type: image/png\r\n\r\n";
        String consentHead = "\r\n"
                + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"consentVersion\"\r\n\r\n";
        String tail = "\r\n--" + boundary + "--\r\n";
        byte[] video = new byte[]{0, 0, 0, 24, 'f', 't', 'y', 'p'};
        byte[] image = new byte[]{(byte) 0x89, 'P', 'N', 'G'};
        return concat(head.getBytes(StandardCharsets.ISO_8859_1), video,
                middle.getBytes(StandardCharsets.ISO_8859_1), image,
                consentHead.getBytes(StandardCharsets.ISO_8859_1),
                VideoService.CONSENT.getBytes(StandardCharsets.ISO_8859_1),
                tail.getBytes(StandardCharsets.ISO_8859_1));
    }

    @Test void parsesThreeNamedPartsInMemory() {
        List<Multipart.Part> parts = Multipart.parse(body("synthetic-boundary"),
                "multipart/form-data; boundary=synthetic-boundary");
        assertThat(parts).hasSize(3);
        assertThat(parts.stream().map(Multipart.Part::name).sorted().toList())
                .containsExactly("consentVersion", "data", "reference_image");
        var consent = parts.stream().filter(part -> part.name().equals("consentVersion")).findFirst().orElseThrow();
        assertThat(consent.hasFilename()).isFalse();
        assertThat(new String(consent.body(), StandardCharsets.UTF_8)).isEqualTo(VideoService.CONSENT);
        var video = parts.stream().filter(part -> part.name().equals("data")).findFirst().orElseThrow();
        assertThat(video.contentType()).isEqualTo("video/mp4");
        assertThat(video.body()).hasSize(8);
    }

    @Test void rejectsMissingBoundaryWrongDispositionAndDuplicateNames() {
        assertThatThrownBy(() -> Multipart.parse(body("x"), "multipart/form-data"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_VIDEO_UPLOAD"));
        assertThatThrownBy(() -> Multipart.parse(body("x"), "multipart/form-data; boundary=" + "a".repeat(201)))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_VIDEO_UPLOAD"));
        String duplicate = "--b\r\nContent-Disposition: form-data; name=\"data\"\r\n\r\nx\r\n"
                + "--b\r\nContent-Disposition: form-data; name=\"data\"\r\n\r\ny\r\n--b--\r\n";
        assertThatThrownBy(() -> Multipart.parse(duplicate.getBytes(StandardCharsets.ISO_8859_1), "multipart/form-data; boundary=b"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_VIDEO_UPLOAD"));
        String wrong = "--b\r\nContent-Disposition: attachment; name=\"data\"\r\n\r\nx\r\n--b--\r\n";
        assertThatThrownBy(() -> Multipart.parse(wrong.getBytes(StandardCharsets.ISO_8859_1), "multipart/form-data; boundary=b"))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.code).isEqualTo("INVALID_VIDEO_UPLOAD"));
    }

    @Test void parsesRealSizedVideoPart() throws Exception {
        byte[] video = java.nio.file.Files.readAllBytes(java.nio.file.Path.of("../frontend/public/assets/try-on-demo.mp4"));
        byte[] image = new byte[]{(byte) 0x89, 'P', 'N', 'G'};
        String boundary = "synthetic0123456789abcdef";
        byte[] body = concat(
                ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"data\"; filename=\"person.mp4\"\r\n"
                        + "Content-Type: video/mp4\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1), video,
                ("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"reference_image\"; filename=\"garment.png\"\r\n"
                        + "Content-Type: image/png\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1), image,
                ("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"consentVersion\"\r\n\r\n"
                        + VideoService.CONSENT + "\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.ISO_8859_1));
        List<Multipart.Part> parts = Multipart.parse(body, "multipart/form-data; boundary=" + boundary);
        assertThat(parts).hasSize(3);
        assertThat(parts.stream().filter(part -> part.name().equals("data")).findFirst().orElseThrow().body())
                .isEqualTo(video);
    }

    private static byte[] concat(byte[]... values) {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        for (byte[] value : values) output.writeBytes(value);
        return output.toByteArray();
    }
}
