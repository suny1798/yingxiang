package cn.yingxiang.bootstrap;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/** M14：普通H.264 MP4的内存校验与去音轨；只读字节，不落盘、不解码。 */
final class Mp4 {
    static final int MAX_BYTES = 26_214_400;
    static final double MAX_SECONDS = 15.0;
    private static final byte[] FTYP = ascii("ftyp"), MOOV = ascii("moov"), MDAT = ascii("mdat");
    private static final Set<String> TABLE = Set.of("stsd", "stts", "stss", "stsc", "stsz", "stco", "co64",
            "ctts", "sdtp", "sbgp", "sgpd");

    record Box(String type, int start, int end) {}
    record Info(double seconds, int width, int height, boolean hasAudio) {}
    record Prepared(byte[] bytes, Info info, boolean removed) {}
    static final class Builder { int count; }

    private Mp4() {}

    private static byte[] ascii(String value) { return value.getBytes(StandardCharsets.ISO_8859_1); }

    static Info inspect(byte[] data, boolean allowAudio) {
        if (data.length < 32 || data.length > MAX_BYTES) fail("请选择不超过25MB的MP4视频。");
        Builder builder = new Builder();
        List<Box> top = boxes(data, 0, data.length, builder);
        length(one(top, "ftyp"), 8);
        if (top.stream().anyMatch(box -> box.type().equals("moof"))) fail("暂不支持分段MP4，请重新导出为普通MP4。");
        if (top.stream().noneMatch(box -> box.type().equals("mdat") && box.end() > box.start())) fail(null);
        List<Box> movie = children(data, one(top, "moov"), builder);
        if (movie.stream().anyMatch(box -> box.type().equals("mvex"))) fail(null);
        Timing movieTiming = timing(data, one(movie, "mvhd"), allowAudio ? 86_400 : MAX_SECONDS + 0.001);
        List<Box> videoTracks = new ArrayList<>(), audioTracks = new ArrayList<>();
        for (Box track : movie.stream().filter(box -> box.type().equals("trak")).toList()) {
            Box handler = one(children(data, one(children(data, track, builder), "mdia", builder), builder), "hdlr", builder);
            length(handler, 12);
            String kind = text(data, handler.start() + 8, 4);
            if (kind.equals("soun")) {
                if (!allowAudio) fail("视频仍有音轨，自动处理未完成，请重新选择视频。");
                audioTracks.add(track);
            } else if (kind.equals("vide")) {
                videoTracks.add(track);
            } else {
                fail("暂不支持此视频轨道结构，请选择普通MP4视频。");
            }
        }
        if (videoTracks.size() != 1 || audioTracks.size() > 4) fail("请选择仅含一条画面轨道的MP4视频。");
        List<Box> track = children(data, videoTracks.getFirst(), builder);
        List<Box> media = children(data, one(track, "mdia", builder), builder);
        Box handler = one(media, "hdlr", builder);
        length(handler, 12);
        if (!text(data, handler.start() + 8, 4).equals("vide")) fail(null);
        Timing mediaTiming = timing(data, one(media, "mdhd", builder), MAX_SECONDS + 0.001);
        if (audioTracks.isEmpty() && Math.abs(mediaTiming.seconds() - movieTiming.seconds()) > 0.15) {
            fail("视频时间信息不一致，请重新导出后再试。");
        }
        List<Box> samples = children(data, one(children(data, one(media, "minf", builder), builder), "stbl", builder), builder);
        Box stsd = one(samples, "stsd", builder);
        length(stsd, 8);
        if (uint(data, stsd.start() + 4) != 1) fail(null);
        Box codec = one(boxes(data, stsd.start() + 8, stsd.end(), builder), "avc1");
        length(codec, 78);
        int width = (int) uint(data, codec.start() + 24, 2), height = (int) uint(data, codec.start() + 26, 2);
        if (Math.min(width, height) < 320 || Math.max(width, height) > 3840
                || !Arrays.stream(new double[]{16.0 / 9, 9.0 / 16, 2, 0.5})
                .anyMatch(ratio -> Math.abs((double) width / height - ratio) < 0.015)) {
            fail("请使用横版16:9 / 2:1或竖版9:16 / 1:2的视频，单边320—3840像素。");
        }
        one(boxes(data, codec.start() + 78, codec.end(), builder), "avcC");
        Box stts = one(samples, "stts", builder);
        length(stts, 8);
        long entries = uint(data, stts.start() + 4);
        if (entries < 1 || entries > 100_000 || stts.start() + 8 + entries * 8 != stts.end()) fail(null);
        long ticks = 0, sampleCount = 0;
        for (long index = 0; index < entries; index++) {
            int pos = (int) (stts.start() + 8 + index * 8);
            long number = uint(data, pos), delta = uint(data, pos + 4);
            if (number == 0 || delta == 0) fail(null);
            ticks += number * delta;
            sampleCount += number;
        }
        double seconds = ticks / (double) mediaTiming.scale();
        if (sampleCount > 15_000 || seconds > MAX_SECONDS + 0.001 || Math.abs(seconds - mediaTiming.seconds()) > 0.05) {
            fail("视频时间表异常或超过15秒，请重新裁剪导出。");
        }
        Box stsz = one(samples, "stsz", builder);
        length(stsz, 12);
        if (uint(data, stsz.start() + 8) != sampleCount) fail(null);
        List<Box> edits = track.stream().filter(box -> box.type().equals("edts")).toList();
        if (edits.size() > 1) fail(null);
        if (!edits.isEmpty()) {
            Box edit = one(children(data, edits.getFirst(), builder), "elst", builder);
            length(edit, 20);
            int pos = edit.start();
            if (data[pos] != 0 || uint(data, pos + 4) != 1 || edit.end() - pos != 20
                    || uint(data, pos + 12, 4) < 0 || uint(data, pos + 16) != 65536
                    || Math.abs(uint(data, pos + 8) / (double) movieTiming.scale()
                    - (audioTracks.isEmpty() ? movieTiming.seconds() : mediaTiming.seconds())) > 0.05) {
                fail("暂不支持变速或多段编辑时间表，请先重新导出视频。");
            }
        }
        return new Info(Math.max(seconds, audioTracks.isEmpty() ? movieTiming.seconds() : mediaTiming.seconds()),
                width, height, !audioTracks.isEmpty());
    }

    static Prepared prepare(byte[] data) {
        Info info = inspect(data, true);
        if (!info.hasAudio()) return new Prepared(data, inspect(data, false), false);
        Builder builder = new Builder();
        List<Box> top = boxes(data, 0, data.length, builder);
        List<Box> movie = children(data, one(top, "moov"), builder);
        Box track = null;
        for (Box candidate : movie) {
            if (!candidate.type().equals("trak")) continue;
            List<Box> items = children(data, candidate, builder);
            Box media = one(items, "mdia", builder);
            Box handler = one(children(data, media, builder), "hdlr", builder);
            if (text(data, handler.start() + 8, 4).equals("vide")) { track = candidate; break; }
        }
        if (track == null) fail(null);
        List<Box> trackItems = children(data, track, builder);
        List<Box> media = children(data, one(trackItems, "mdia", builder), builder);
        List<Box> minf = children(data, one(media, "minf", builder), builder);
        List<Box> table = children(data, one(minf, "stbl", builder), builder);
        if (table.stream().anyMatch(box -> !TABLE.contains(box.type()))) fail(null);
        List<Box> offsets = table.stream().filter(box -> box.type().equals("stco") || box.type().equals("co64")).toList();
        if (offsets.size() != 1) fail(null);
        Box offsetBox = offsets.getFirst();
        int width = offsetBox.type().equals("co64") ? 8 : 4;
        long chunkCount = uint(data, offsetBox.start() + 4);
        if (chunkCount < 1 || chunkCount > 15_000 || offsetBox.end() - offsetBox.start() != 8 + chunkCount * width) fail(null);
        long[] chunkOffsets = new long[(int) chunkCount];
        for (int index = 0; index < chunkCount; index++) {
            chunkOffsets[index] = uint(data, (int) (offsetBox.start() + 8 + (long) index * width), width);
        }
        Box sizes = one(table, "stsz", builder);
        long fixed = uint(data, sizes.start() + 4), sampleCount = uint(data, sizes.start() + 8);
        if (sampleCount < 1 || sampleCount > 15_000 || sizes.end() - sizes.start() != 12 + (fixed == 0 ? sampleCount * 4 : 0)) fail(null);
        long[] sampleSizes = new long[(int) sampleCount];
        for (int index = 0; index < sampleCount; index++) {
            sampleSizes[index] = fixed != 0 ? fixed : uint(data, (int) (sizes.start() + 12 + (long) index * 4));
            if (sampleSizes[index] == 0) fail(null);
        }
        Box mapping = one(table, "stsc", builder);
        long mappingCount = uint(data, mapping.start() + 4);
        if (mappingCount < 1 || mappingCount > chunkCount || mapping.end() - mapping.start() != 8 + mappingCount * 12) fail(null);
        long[][] entries = new long[(int) mappingCount][3];
        for (int index = 0; index < mappingCount; index++) {
            int pos = (int) (mapping.start() + 8 + (long) index * 12);
            entries[index][0] = uint(data, pos);
            entries[index][1] = uint(data, pos + 4);
            entries[index][2] = uint(data, pos + 8);
            if (index == 0 && entries[index][0] != 1) fail(null);
            if (entries[index][0] < 1 || entries[index][0] > chunkCount || entries[index][1] < 1 || entries[index][2] != 1) fail(null);
            if (index > 0 && entries[index - 1][0] >= entries[index][0]) fail(null);
        }
        List<Box> mdats = top.stream().filter(box -> box.type().equals("mdat")).toList();
        List<byte[]> chunks = new ArrayList<>();
        List<long[]> ranges = new ArrayList<>();
        int nextSample = 0, mappingIndex = 0;
        for (int index = 0; index < chunkCount; index++) {
            long offset = chunkOffsets[index];
            while (mappingIndex + 1 < entries.length && entries[mappingIndex + 1][0] <= index + 1L) mappingIndex++;
            int per = (int) entries[mappingIndex][1];
            if (nextSample + per > sampleCount) fail(null);
            long size = 0;
            for (int sample = nextSample; sample < nextSample + per; sample++) size += sampleSizes[sample];
            long end = offset + size;
            if (mdats.stream().noneMatch(box -> box.start() <= offset && end <= box.end())) fail(null);
            ranges.add(new long[]{offset, end});
            chunks.add(Arrays.copyOfRange(data, (int) offset, (int) end));
            nextSample += per;
        }
        if (nextSample != sampleCount) fail(null);
        ranges.sort((left, right) -> Long.compare(left[0], right[0]));
        for (int index = 0; index + 1 < ranges.size(); index++) {
            if (ranges.get(index)[1] > ranges.get(index + 1)[0]) fail(null);
        }
        long[] newOffsets = new long[(int) chunkCount];
        byte[] ftyp = atom(FTYP, payload(data, one(top, "ftyp")));
        byte[] movieBytes = buildMovie(data, movie, trackItems, media, minf, table, offsetBox, chunkCount, info, newOffsets);
        long position = ftyp.length + movieBytes.length + 8L;
        for (int index = 0; index < chunkCount; index++) {
            newOffsets[index] = position;
            position += chunks.get(index).length;
        }
        movieBytes = buildMovie(data, movie, trackItems, media, minf, table, offsetBox, chunkCount, info, newOffsets);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.writeBytes(ftyp);
        output.writeBytes(movieBytes);
        ByteArrayOutputStream mediaData = new ByteArrayOutputStream();
        for (byte[] chunk : chunks) mediaData.writeBytes(chunk);
        output.writeBytes(atom(MDAT, mediaData.toByteArray()));
        byte[] result = output.toByteArray();
        return new Prepared(result, inspect(result, false), true);
    }

    private static byte[] buildMovie(byte[] data, List<Box> movie, List<Box> trackItems, List<Box> media, List<Box> minf,
                                     List<Box> table, Box offsetBox, long chunkCount, Info info, long[] newOffsets) {
        Builder builder = new Builder();
        ByteArrayOutputStream stcoPayload = new ByteArrayOutputStream();
        stcoPayload.writeBytes(new byte[4]);
        stcoPayload.writeBytes(u32(chunkCount));
        for (long value : newOffsets) stcoPayload.writeBytes(u32(value));
        byte[] stco = atom(ascii("stco"), stcoPayload.toByteArray());
        ByteArrayOutputStream stblPayload = new ByteArrayOutputStream();
        for (Box box : table) {
            if (box.type().equals("stco") || box.type().equals("co64")) stblPayload.writeBytes(stco);
            else stblPayload.writeBytes(atom(ascii(box.type()), payload(data, box)));
        }
        byte[] stbl = atom(ascii("stbl"), stblPayload.toByteArray());
        ByteArrayOutputStream urlPayload = new ByteArrayOutputStream();
        urlPayload.writeBytes(new byte[]{0, 0, 0, 1});
        byte[] dref = atom(ascii("dref"), concat(new byte[4], u32(1), atom(ascii("url "), urlPayload.toByteArray())));
        byte[] dinf = atom(ascii("dinf"), dref);
        Box vmhd = one(minf, "vmhd", builder);
        byte[] minimum = atom(ascii("minf"), concat(atom(ascii("vmhd"), payload(data, vmhd)), dinf, stbl));
        ByteArrayOutputStream mdiaPayload = new ByteArrayOutputStream();
        for (String kind : List.of("mdhd", "hdlr")) mdiaPayload.writeBytes(atom(ascii(kind), payload(data, one(media, kind, builder))));
        mdiaPayload.writeBytes(minimum);
        byte[] mdia = atom(ascii("mdia"), mdiaPayload.toByteArray());
        ByteArrayOutputStream trakPayload = new ByteArrayOutputStream();
        for (Box box : trackItems) {
            if (box.type().equals("tkhd") || box.type().equals("edts")) trakPayload.writeBytes(atom(ascii(box.type()), payload(data, box)));
        }
        trakPayload.writeBytes(mdia);
        byte[] trak = atom(ascii("trak"), trakPayload.toByteArray());
        byte[] mvhd = payload(data, one(movie, "mvhd", builder)).clone();
        int version = mvhd[0] & 0xff;
        int scaleOffset = version != 0 ? 20 : 12, durationOffset = version != 0 ? 24 : 16, durationWidth = version != 0 ? 8 : 4;
        long scale = uint(mvhd, scaleOffset);
        long duration = Math.round(info.seconds() * scale);
        for (int index = 0; index < durationWidth; index++) {
            mvhd[durationOffset + durationWidth - 1 - index] = (byte) ((duration >>> (8 * index)) & 0xff);
        }
        return atom(MOOV, concat(atom(ascii("mvhd"), mvhd), trak));
    }

    /** 参考图格式与像素上限；与旧validate_image同义。 */
    static void validateImage(byte[] data, String mime) {
        if (data.length > 10 * 1024 * 1024) imageFail("图片超过10MB，请换一张更小的参考图。");
        if (!Set.of("image/png", "image/jpeg", "image/webp").contains(mime)) imageFail("请选择JPG、PNG或WebP静态参考图。");
        boolean png = data.length >= 8 && data[0] == (byte) 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G'
                && data[4] == 0x0d && data[5] == 0x0a && data[6] == 0x1a && data[7] == 0x0a;
        boolean jpeg = data.length >= 3 && data[0] == (byte) 0xff && data[1] == (byte) 0xd8 && data[2] == (byte) 0xff;
        boolean webp = data.length >= 12 && text(data, 0, 4).equals("RIFF") && text(data, 8, 4).equals("WEBP");
        if (!((mime.equals("image/png") && png) || (mime.equals("image/jpeg") && jpeg) || (mime.equals("image/webp") && webp))) {
            imageFail(null);
        }
        if (png) {
            if (data.length < 33 || !text(data, 12, 4).equals("IHDR")) imageFail("PNG参考图不完整，请换一张图片。");
            dimensions(uint(data, 16), uint(data, 20));
            long offset = 8;
            while (offset + 12 <= data.length) {
                long length = uint(data, (int) offset);
                if (length > data.length - offset - 12) imageFail("PNG参考图已损坏，请换一张图片。");
                if (text(data, (int) offset + 4, 4).equals("acTL")) imageFail("暂不支持动图，请选择静态参考图。");
                offset += length + 12;
            }
        }
        if (jpeg) {
            boolean found = false;
            int offset = 2;
            while (offset < data.length) {
                if ((data[offset] & 0xff) != 255) imageFail("JPEG参考图已损坏，请重新导出。");
                offset++;
                while (offset < data.length && (data[offset] & 0xff) == 255) offset++;
                if (offset >= data.length) imageFail("JPEG参考图不完整，请换一张图片。");
                int marker = data[offset] & 0xff;
                offset++;
                if (marker == 218 || marker == 217) break;
                if (marker == 1 || (marker >= 208 && marker <= 215)) continue;
                if (offset + 2 > data.length) imageFail("JPEG参考图不完整，请换一张图片。");
                int length = (int) uint(data, offset, 2);
                if (length < 2 || offset + length > data.length) imageFail("JPEG参考图已损坏，请换一张图片。");
                if (Set.of(192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207).contains(marker)) {
                    if (length < 8) imageFail("JPEG参考图尺寸信息无效，请重新导出。");
                    dimensions(uint(data, offset + 5, 2), uint(data, offset + 3, 2));
                    found = true;
                }
                offset += length;
            }
            if (!found) imageFail("JPEG参考图缺少有效尺寸，请重新导出。");
        }
        if (webp) {
            if (data.length < 20 || uint(data, 4, 4) + 8 != data.length) imageFail("WebP参考图不完整或已损坏，请重新导出。");
            boolean found = false;
            int offset = 12;
            while (offset < data.length) {
                if (offset + 8 > data.length) imageFail("WebP参考图不完整，请换一张图片。");
                String kind = text(data, offset, 4);
                long length = uint(data, offset + 4, 4);
                int start = offset + 8;
                long end = start + length + length % 2;
                if (end > data.length) imageFail("WebP参考图不完整，请换一张图片。");
                if (kind.equals("ANIM") || kind.equals("ANMF")) imageFail("暂不支持动图，请选择静态参考图。");
                if (kind.equals("VP8X")) {
                    if (length != 10) imageFail("WebP参考图尺寸信息无效，请重新导出。");
                    if ((data[start] & 2) != 0) imageFail("暂不支持动图，请选择静态参考图。");
                    dimensions(1 + uint(data, start + 4, 3), 1 + uint(data, start + 7, 3));
                    found = true;
                } else if (kind.equals("VP8 ")) {
                    if (length < 10 || !text(data, start + 3, 3).equals("\u009d\u0001*")) imageFail("WebP参考图已损坏，请重新导出。");
                    dimensions(uint(data, start + 6, 2) & 0x3fff, uint(data, start + 8, 2) & 0x3fff);
                    found = true;
                } else if (kind.equals("VP8L")) {
                    if (length < 5 || (data[start] & 0xff) != 47) imageFail("WebP参考图已损坏，请重新导出。");
                    long bits = uint(data, start + 1, 4);
                    dimensions(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
                    found = true;
                }
                offset = (int) end;
            }
            if (!found) imageFail("WebP参考图缺少有效尺寸，请重新导出。");
        }
    }

    private static void dimensions(long width, long height) {
        if (width == 0 || height == 0 || width * height > 20_000_000) imageFail("参考图像素过大或尺寸无效，请缩小后再试。");
    }

    private static void imageFail(String message) {
        throw new IllegalArgumentException(message == null ? "参考图内容与格式不符，请重新导出后再试。" : message);
    }

    private static List<Box> boxes(byte[] data, int start, int end, Builder builder) {
        List<Box> result = new ArrayList<>();
        while (start < end) {
            builder.count++;
            if (builder.count > 10_000 || start + 8 > end) fail(null);
            long size = uint(data, start);
            String type = text(data, start + 4, 4);
            int header = 8;
            if (size == 1) {
                if (start + 16 > end) fail(null);
                size = uint(data, start + 8, 8);
                header = 16;
            } else if (size == 0) {
                size = end - start;
            }
            if (size < header || start + size > end) fail(null);
            result.add(new Box(type, start + header, (int) (start + size)));
            start += (int) size;
        }
        return result;
    }

    private static List<Box> children(byte[] data, Box box, Builder builder) {
        return boxes(data, box.start(), box.end(), builder);
    }

    private static Box one(List<Box> items, String type) {
        return one(items, type, null);
    }

    private static Box one(List<Box> items, String type, Builder ignored) {
        List<Box> found = items.stream().filter(box -> box.type().equals(type)).toList();
        if (found.size() != 1) fail(null);
        return found.getFirst();
    }

    private static void length(Box box, int minimum) {
        if (box.end() - box.start() < minimum) fail(null);
    }

    private record Timing(double seconds, long scale) {}

    private static Timing timing(byte[] data, Box box, double maximum) {
        length(box, 20);
        int version = data[box.start()] & 0xff;
        if (version != 0 && version != 1) fail(null);
        length(box, version != 0 ? 32 : 20);
        long scale = uint(data, box.start() + (version != 0 ? 20 : 12));
        long ticks = version != 0 ? uint(data, box.start() + 24, 8) : uint(data, box.start() + 16);
        double seconds = scale != 0 ? ticks / (double) scale : 0;
        if (scale == 0 || seconds < 1 || seconds > maximum) fail("首版支持1—15秒视频，请先裁剪后再上传。");
        return new Timing(seconds, scale);
    }

    private static byte[] payload(byte[] data, Box box) { return Arrays.copyOfRange(data, box.start(), box.end()); }

    private static String text(byte[] data, int start, int length) {
        if (start < 0 || start + length > data.length) fail(null);
        return new String(data, start, length, StandardCharsets.ISO_8859_1);
    }

    private static long uint(byte[] data, int position) { return uint(data, position, 4); }

    private static long uint(byte[] data, int position, int width) {
        if (position < 0 || position + width > data.length) fail(null);
        long value = 0;
        for (int index = 0; index < width; index++) value = (value << 8) | (data[position + index] & 0xffL);
        return value;
    }

    private static byte[] atom(byte[] type, byte[] value) {
        return concat(u32(value.length + 8L), type, value);
    }

    private static byte[] u32(long value) {
        return new byte[]{(byte) (value >>> 24), (byte) (value >>> 16), (byte) (value >>> 8), (byte) value};
    }

    private static byte[] concat(byte[]... values) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte[] value : values) output.writeBytes(value);
        return output.toByteArray();
    }

    private static void fail(String message) {
        throw new IllegalArgumentException(message == null ? "视频格式无法验证，请导出为普通H.264 MP4后再试。" : message);
    }
}
