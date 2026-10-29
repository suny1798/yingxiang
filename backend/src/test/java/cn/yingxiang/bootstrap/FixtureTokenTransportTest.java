package cn.yingxiang.bootstrap;

import cn.yingxiang.manager.FixtureTokenTransport;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.*;

class FixtureTokenTransportTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private static final String KEY = "synthetic-permanent-key";

    @Test void postsExactScopeOnce() throws Exception {
        AtomicReference<String> request = new AtomicReference<>(), apiKey = new AtomicReference<>(), method = new AtomicReference<>();
        AtomicInteger calls = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/client/tokens", exchange -> {
            calls.incrementAndGet(); apiKey.set(exchange.getRequestHeaders().getFirst("X-API-KEY")); method.set(exchange.getRequestMethod());
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = "{\"apiKey\":\"synthetic-client-key\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try (var transport = transport(server, Duration.ofSeconds(2))) {
            assertThat(transport.issue("synthetic-model", "http://127.0.0.1:8791", 30).get("apiKey").asString()).isEqualTo("synthetic-client-key");
            assertThat(calls.get()).isEqualTo(1); assertThat(apiKey.get()).isEqualTo(KEY); assertThat(method.get()).isEqualTo("POST");
            assertThat(json.readTree(request.get())).isEqualTo(json.readTree("""
                    {"expiresIn":10,"allowedModels":["synthetic-model"],"allowedOrigins":["http://127.0.0.1:8791"],
                    "constraints":{"realtime":{"maxSessionDuration":30}}}
                    """));
        } finally { server.stop(0); }
    }

    @Test void rejectsRedirectsErrorsMalformedAndOversizedBodiesWithoutRetry() throws Exception {
        String exact = "{\"padding\":\"" + "x".repeat(16_370) + "\"}";
        assertThat(exact.getBytes(StandardCharsets.UTF_8)).hasSize(16_384);
        for (var sample : new Sample[]{new Sample(200, "{}", false, true), new Sample(200, exact, false, true),
                new Sample(200, exact + " ", false, false), new Sample(200, exact + " ", true, false),
                new Sample(302, "{}", false, false), new Sample(401, "{}", false, false), new Sample(500, "{}", false, false),
                new Sample(200, "{} {}", false, false), new Sample(200, "null", false, false), new Sample(200, "[]", false, false),
                new Sample(200, "broken", false, false), new Sample(200, "\ufeff{}", false, false)}) {
            AtomicInteger calls = new AtomicInteger();
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/v1/client/tokens", exchange -> {
                calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
                exchange.getResponseHeaders().set("Location", "/v1/client/tokens");
                byte[] bytes = sample.body.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(sample.status, sample.chunked ? 0 : bytes.length);
                try { exchange.getResponseBody().write(bytes); } catch (java.io.IOException ignored) {} finally { exchange.close(); }
            });
            server.start();
            try (var transport = transport(server, Duration.ofSeconds(2))) {
                if (sample.accept) assertThatCode(() -> transport.issue("model", "origin", 15)).doesNotThrowAnyException();
                else assertThatThrownBy(() -> transport.issue("model", "origin", 15))
                        .isInstanceOf(FixtureTokenTransport.InvalidResponse.class).hasMessage("INVALID_UPSTREAM_RESPONSE");
                assertThat(calls.get()).as("status=%s size=%s chunked=%s", sample.status, sample.body.length(), sample.chunked).isEqualTo(1);
            } finally { server.stop(0); }
        }
    }

    @Test void totalDeadlineCoversBodyAfterHeadersAndDoesNotResend() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newVirtualThreadPerTaskExecutor(); server.setExecutor(executor);
        server.createContext("/v1/client/tokens", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(200, 0);
            try {
                exchange.getResponseBody().write('{'); exchange.getResponseBody().flush();
                Thread.sleep(1500); exchange.getResponseBody().write('}');
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            catch (java.io.IOException ignored) {} finally { exchange.close(); }
        });
        server.start();
        try (var transport = transport(server, Duration.ofMillis(500))) {
            long start = System.nanoTime();
            assertThatThrownBy(() -> transport.issue("model", "origin", 15)).isInstanceOf(FixtureTokenTransport.InvalidResponse.class);
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(1250));
            assertThat(calls.get()).isEqualTo(1);
        } finally { server.stop(0); executor.shutdownNow(); executor.close(); }
    }

    @Test void rejectsExternalTargetsAndRealCredentialsBeforeNetworkAccess() {
        for (String uri : new String[]{"https://api.decart.ai/v1/client/tokens", "http://localhost:9999/v1/client/tokens",
                "http://127.0.0.1:9999/other", "http://127.0.0.1:9999/v1/client/tokens?redirect=1",
                "http://user:pwd@127.0.0.1:9999/v1/client/tokens"}) {
            assertThatThrownBy(() -> new FixtureTokenTransport(URI.create(uri), KEY, json, Duration.ofSeconds(1))).isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> new FixtureTokenTransport(URI.create("http://127.0.0.1:9999/v1/client/tokens"), "real-key", json, Duration.ofSeconds(1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void ambiguousDisconnectDoesNotRepeatPost() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/client/tokens", exchange -> {
            calls.incrementAndGet(); exchange.getRequestBody().readAllBytes(); exchange.close();
        });
        server.start();
        try (var transport = transport(server, Duration.ofSeconds(2))) {
            assertThatThrownBy(() -> transport.issue("model", "origin", 15))
                    .isInstanceOf(FixtureTokenTransport.InvalidResponse.class).hasMessage("INVALID_UPSTREAM_RESPONSE");
            assertThat(calls.get()).isEqualTo(1);
        } finally { server.stop(0); }
    }

    @Test void invalidUtf8AndCompressionAreRejected() throws Exception {
        for (boolean compressed : new boolean[]{false, true}) {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/v1/client/tokens", exchange -> {
                exchange.getRequestBody().readAllBytes();
                byte[] bytes = compressed ? "{}".getBytes(StandardCharsets.UTF_8) : new byte[]{'{', '"', 'x', '"', ':', '"', (byte) 0xff, '"', '}'};
                if (compressed) exchange.getResponseHeaders().set("Content-Encoding", "gzip");
                exchange.sendResponseHeaders(200, bytes.length);
                try { exchange.getResponseBody().write(bytes); } catch (java.io.IOException ignored) {} finally { exchange.close(); }
            });
            server.start();
            try (var transport = transport(server, Duration.ofSeconds(2))) {
                assertThatThrownBy(() -> transport.issue("model", "origin", 15)).isInstanceOf(FixtureTokenTransport.InvalidResponse.class);
            } finally { server.stop(0); }
        }
    }

    private FixtureTokenTransport transport(HttpServer server, Duration duration) {
        return new FixtureTokenTransport(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/client/tokens"), KEY, json, duration);
    }
    private record Sample(int status, String body, boolean chunked, boolean accept) {}
}
