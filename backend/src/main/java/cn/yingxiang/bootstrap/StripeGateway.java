package cn.yingxiang.bootstrap;

import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** M13-a：Stripe沙盒端口。只允许本机合成替身地址，不发真实网络请求。 */
public interface StripeGateway {
    String accountId();
    Map<String, Object> createSession(Map<String, Object> params, String idempotencyKey);
    Map<String, Object> session(String id);

    /** Stripe签名格式：t=...,v1=...，HMAC-SHA256(secret, "{t}.{payload}")，容差300秒。 */
    static void verifySignature(byte[] payload, String header, String secret, long nowSeconds) {
        if (header == null || header.isBlank()) throw invalidSignature();
        Long timestamp = null;
        List<String> signatures = new ArrayList<>();
        for (String item : header.split(",", -1)) {
            String[] pair = item.strip().split("=", 2);
            if (pair.length != 2) continue;
            if (pair[0].equals("t") && pair[1].matches("[0-9]{1,12}")) timestamp = Long.parseLong(pair[1]);
            if (pair[0].equals("v1") && pair[1].matches("[a-f0-9]{64}")) signatures.add(pair[1]);
        }
        if (timestamp == null || signatures.isEmpty() || Math.abs(nowSeconds - timestamp) > 300) throw invalidSignature();
        byte[] expected = hmac(secret, (timestamp + ".").getBytes(StandardCharsets.UTF_8), payload);
        for (String candidate : signatures) {
            if (MessageDigest.isEqual(expected, HexFormat.of().parseHex(candidate))) return;
        }
        throw invalidSignature();
    }

    static byte[] hmac(String secret, byte[] prefix, byte[] payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            mac.update(prefix);
            return mac.doFinal(payload);
        } catch (java.security.GeneralSecurityException error) {
            throw new IllegalStateException("HMAC unavailable");
        }
    }

    static BusinessFailure invalidSignature() {
        return new BusinessFailure("INVALID_SIGNATURE", "付款通知验签失败。", 400);
    }

    /** 仅本机回环地址；合成替身与真实沙盒API同形状，但不含真实凭据。 */
    final class Http implements StripeGateway {
        private static final String API_VERSION = "2026-09-30.endive";
        private final String base;
        private final String secret;
        private final JsonMapper json = JsonMapper.builder().build();
        private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build();

        public Http(String base, String secret) {
            URI uri = URI.create(base);
            String host = uri.getHost();
            if (!Set.of("http", "https").contains(uri.getScheme()) || host == null
                    || !(host.equals("127.0.0.1") || host.equals("localhost") || host.equals("::1"))
                    || uri.getQuery() != null || uri.getFragment() != null || uri.getUserInfo() != null) {
                throw new IllegalStateException("Stripe fixture base must be loopback");
            }
            this.base = base.replaceAll("/+$", "");
            this.secret = secret;
        }

        @Override public String accountId() {
            return (String) request("GET", "/v1/account", null, null).get("id");
        }

        @Override public Map<String, Object> createSession(Map<String, Object> params, String idempotencyKey) {
            return request("POST", "/v1/checkout/sessions", form(params), idempotencyKey);
        }

        @Override public Map<String, Object> session(String id) {
            if (id == null || !id.matches("[A-Za-z0-9_]{1,120}")) throw BusinessFailure.unavailable();
            return request("GET", "/v1/checkout/sessions/" + id, null, null);
        }

        @SuppressWarnings("unchecked")
        private Map<String, Object> request(String method, String path, String body, String idempotencyKey) {
            try {
                HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + path))
                        .timeout(Duration.ofSeconds(15))
                        .header("Authorization", "Bearer " + secret)
                        .header("Stripe-Version", API_VERSION)
                        .header("Accept", "application/json");
                if (idempotencyKey != null) builder.header("Idempotency-Key", idempotencyKey);
                if (body != null) builder.header("Content-Type", "application/x-www-form-urlencoded");
                builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
                HttpResponse<byte[]> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() < 200 || response.statusCode() > 299) throw BusinessFailure.unavailable();
                Object value = json.readValue(new String(response.body(), StandardCharsets.UTF_8), Map.class);
                if (!(value instanceof Map)) throw BusinessFailure.unavailable();
                return (Map<String, Object>) value;
            } catch (BusinessFailure error) {
                throw error;
            } catch (Exception error) {
                throw BusinessFailure.unavailable();
            }
        }

        static String form(Map<String, Object> params) {
            List<String> pairs = new ArrayList<>();
            flatten("", params, pairs);
            return String.join("&", pairs);
        }

        private static void flatten(String key, Object value, List<String> pairs) {
            if (value == null) return;
            if (value instanceof Map<?, ?> map) {
                for (var entry : map.entrySet()) {
                    String child = key.isEmpty() ? String.valueOf(entry.getKey()) : key + "[" + entry.getKey() + "]";
                    flatten(child, entry.getValue(), pairs);
                }
            } else if (value instanceof List<?> list) {
                for (int index = 0; index < list.size(); index++) flatten(key + "[" + index + "]", list.get(index), pairs);
            } else if (value instanceof Boolean bool) {
                pairs.add(encode(key) + "=" + bool);
            } else {
                pairs.add(encode(key) + "=" + encode(String.valueOf(value)));
            }
        }

        private static String encode(String value) {
            return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
        }
    }

    static Map<String, Object> map(Object... pairs) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) value.put((String) pairs[index], pairs[index + 1]);
        return value;
    }
}
