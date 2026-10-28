package cn.yingxiang.bootstrap;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** M14：有界内存multipart解析；不 spool 到磁盘、不信任文件名或路径。 */
final class Multipart {
    record Part(String name, boolean hasFilename, String contentType, byte[] body) {}

    private Multipart() {}

    static List<Part> parse(byte[] data, String contentType) {
        String boundary = boundary(contentType);
        if (boundary == null) throw invalidUpload();
        byte[] delimiter = ("--" + boundary).getBytes(StandardCharsets.ISO_8859_1);
        if (!startsWith(data, 0, delimiter)) throw invalidUpload();
        List<Part> parts = new ArrayList<>();
        int position = delimiter.length;
        while (true) {
            if (position + 2 > data.length) throw invalidUpload();
            if (data[position] == '-' && data[position + 1] == '-') {
                position += 2;
                if (position + 2 <= data.length && data[position] == '\r' && data[position + 1] == '\n') position += 2;
                if (position != data.length) throw invalidUpload();
                break;
            }
            if (!(position + 2 <= data.length && data[position] == '\r' && data[position + 1] == '\n')) throw invalidUpload();
            position += 2;
            int headerEnd = indexOf(data, new byte[]{'\r', '\n', '\r', '\n'}, position);
            if (headerEnd < 0) throw invalidUpload();
            Map<String, String> headers = headers(data, position, headerEnd);
            int bodyStart = headerEnd + 4;
            int next = indexOf(data, concat(new byte[]{'\r', '\n'}, delimiter), bodyStart);
            if (next < 0) throw invalidUpload();
            byte[] body = java.util.Arrays.copyOfRange(data, bodyStart, next);
            if (body.length > 25 * 1024 * 1024) throw invalidUpload();
            if (parts.size() >= 3) throw invalidUpload();
            parts.add(part(headers, body));
            position = next + 2 + delimiter.length;
        }
        List<String> names = parts.stream().map(Part::name).sorted().toList();
        if (!names.equals(List.of("consentVersion", "data", "reference_image"))) throw invalidUpload();
        return parts;
    }

    private static Part part(Map<String, String> headers, byte[] body) {
        String disposition = headers.getOrDefault("content-disposition", "");
        String[] segments = disposition.split(";");
        if (!segments[0].strip().equalsIgnoreCase("form-data")) throw invalidUpload();
        Map<String, String> params = new LinkedHashMap<>();
        for (int index = 1; index < segments.length; index++) {
            String segment = segments[index].strip();
            int equals = segment.indexOf('=');
            if (equals <= 0) continue;
            String key = segment.substring(0, equals).strip().toLowerCase(Locale.ROOT);
            String value = segment.substring(equals + 1).strip();
            if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
                value = value.substring(1, value.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
            }
            params.put(key, value);
        }
        String name = params.get("name");
        if (name == null || name.isEmpty()) throw invalidUpload();
        return new Part(name, params.containsKey("filename"), headers.getOrDefault("content-type", ""), body);
    }

    private static Map<String, String> headers(byte[] data, int start, int end) {
        Map<String, String> headers = new LinkedHashMap<>();
        int position = start, total = 0;
        while (position < end) {
            int lineEnd = indexOf(data, new byte[]{'\r', '\n'}, position);
            if (lineEnd < 0 || lineEnd > end) throw invalidUpload();
            String line = new String(data, position, lineEnd - position, StandardCharsets.ISO_8859_1);
            int colon = line.indexOf(':');
            if (colon <= 0) throw invalidUpload();
            String key = line.substring(0, colon).strip().toLowerCase(Locale.ROOT);
            String value = line.substring(colon + 1).strip();
            if (key.length() > 1024 || value.length() > 2048) throw invalidUpload();
            total += key.length() + value.length();
            if (total > 4096 || headers.containsKey(key)) throw invalidUpload();
            headers.put(key, value);
            position = lineEnd + 2;
        }
        return headers;
    }

    private static String boundary(String contentType) {
        if (contentType == null) return null;
        for (String segment : contentType.split(";")) {
            String item = segment.strip();
            if (item.toLowerCase(Locale.ROOT).startsWith("boundary=")) {
                String value = item.substring("boundary=".length()).strip();
                if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.substring(1, value.length() - 1);
                return value.length() >= 1 && value.length() <= 200 ? value : null;
            }
        }
        return null;
    }

    private static boolean startsWith(byte[] data, int offset, byte[] value) {
        if (offset + value.length > data.length) return false;
        for (int index = 0; index < value.length; index++) if (data[offset + index] != value[index]) return false;
        return true;
    }

    private static int indexOf(byte[] data, byte[] value, int from) {
        outer:
        for (int position = Math.max(0, from); position + value.length <= data.length; position++) {
            for (int index = 0; index < value.length; index++) {
                if (data[position + index] != value[index]) continue outer;
            }
            return position;
        }
        return -1;
    }

    private static byte[] concat(byte[] left, byte[] right) {
        byte[] result = new byte[left.length + right.length];
        System.arraycopy(left, 0, result, 0, left.length);
        System.arraycopy(right, 0, result, left.length, right.length);
        return result;
    }

    private static BusinessFailure invalidUpload() {
        return new BusinessFailure("INVALID_VIDEO_UPLOAD", "上传内容无法读取，请重新选择素材。", 400);
    }
}
