package cn.yingxiang.bootstrap;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** 有界临时令牌传输；默认只接受替身，显式runtime固定HTTPS供应商。 */
public final class FixtureTokenTransport implements AutoCloseable {
    private static final int LIMIT = 16_384;
    private final HttpClient client;
    private final URI endpoint;
    private final Duration timeout;
    private final JsonMapper json;
    private final String key;

    public FixtureTokenTransport(URI endpoint, String syntheticKey, JsonMapper json, Duration timeout) {
        this(endpoint, syntheticKey, json, timeout, false);
    }

    public FixtureTokenTransport(URI endpoint, String syntheticKey, JsonMapper json, Duration timeout, boolean runtime) {
        RuntimePolicy.endpoint(endpoint, "api.decart.ai", "/v1/client/tokens", runtime);
        if (!runtime && (!"127.0.0.1".equals(endpoint.getHost()) || endpoint.getPort() <= 0
                || !"/v1/client/tokens".equals(endpoint.getPath()))) throw new IllegalArgumentException("Invalid fixture endpoint");
        if (!"true".equals(System.getProperty("jdk.httpclient.disableRetryConnect"))
                || !"false".equals(System.getProperty("jdk.httpclient.enableAllMethodRetry")))
            throw new IllegalStateException("Fixture JVM must explicitly disable HTTP retries");
        RuntimePolicy.tokenKey(syntheticKey, runtime);
        if (timeout.isNegative() || timeout.isZero() || timeout.compareTo(Duration.ofSeconds(10)) > 0)
            throw new IllegalArgumentException("Fixture deadline out of range");
        this.endpoint = endpoint; this.key = syntheticKey; this.json = json; this.timeout = timeout;
        client = HttpClient.newBuilder().connectTimeout(timeout).version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NEVER).proxy(new ProxySelector() {
                    @Override public List<Proxy> select(URI uri) { return List.of(Proxy.NO_PROXY); }
                    @Override public void connectFailed(URI uri, SocketAddress address, java.io.IOException error) {}
                }).build();
    }

    /** 一次POST，无应用重试；总体截止覆盖响应头和整个响应体。 */
    public JsonNode issue(String model, String origin, int seconds) {
        if (!List.of(15, 30, 60).contains(seconds)) throw new IllegalArgumentException("Invalid fixture duration");
        var body = Map.of("expiresIn", 10, "allowedModels", List.of(model), "allowedOrigins", List.of(origin),
                "constraints", Map.of("realtime", Map.of("maxSessionDuration", seconds)));
        var request = HttpRequest.newBuilder(endpoint).timeout(timeout).header("X-API-KEY", key)
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body))).build();
        CompletableFuture<HttpResponse<byte[]>> future = client.sendAsync(request, info -> {
            if (info.statusCode() < 200 || info.statusCode() >= 300
                    || info.headers().firstValueAsLong("Content-Length").orElse(0) > LIMIT
                    || info.headers().firstValue("Content-Encoding").filter(value -> !value.equalsIgnoreCase("identity")).isPresent())
                throw new InvalidResponse();
            return new LimitedBody();
        });
        try {
            byte[] bytes = future.get(timeout.toNanos(), TimeUnit.NANOSECONDS).body();
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode token = json.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(text);
            if (token == null || !token.isObject()) throw new InvalidResponse();
            return token;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt(); throw new InvalidResponse();
        } catch (Exception error) { throw new InvalidResponse(); }
        finally { if (!future.isDone()) future.cancel(true); }
    }

    @Override public void close() { client.shutdownNow(); }

    /** 固定错误，不将URI、原始响应、header或驱动异常交给调用方。 */
    public static final class InvalidResponse extends RuntimeException {
        private InvalidResponse() { super("INVALID_UPSTREAM_RESPONSE"); }
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        @Override public CompletionStage<byte[]> getBody() { return body; }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        @Override public void onNext(List<ByteBuffer> chunks) {
            for (ByteBuffer chunk : chunks) {
                if (chunk.remaining() > LIMIT - bytes.size()) {
                    subscription.cancel(); body.completeExceptionally(new InvalidResponse()); return;
                }
                byte[] part = new byte[chunk.remaining()]; chunk.get(part); bytes.writeBytes(part);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { body.completeExceptionally(new InvalidResponse()); }
        @Override public void onComplete() { body.complete(bytes.toByteArray()); }
    }
}
