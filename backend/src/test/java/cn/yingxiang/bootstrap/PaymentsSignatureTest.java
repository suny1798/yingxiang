package cn.yingxiang.bootstrap;

import cn.yingxiang.exception.BusinessFailure;
import cn.yingxiang.manager.StripeGateway;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PaymentsSignatureTest {
    private static final String SECRET = "whsec_synthetic_only";
    private static final long NOW = 1_760_000_000L;
    private static final byte[] PAYLOAD = "{\"id\":\"evt_synthetic\",\"type\":\"checkout.session.completed\"}"
            .getBytes(StandardCharsets.UTF_8);

    private static String signature(long timestamp, byte[] payload) {
        byte[] value = StripeGateway.hmac(SECRET, (timestamp + ".").getBytes(StandardCharsets.UTF_8), payload);
        return "t=" + timestamp + ",v1=" + HexFormat.of().formatHex(value);
    }

    @Test void acceptsValidStripeSignature() {
        assertThatCode(() -> StripeGateway.verifySignature(PAYLOAD, signature(NOW, PAYLOAD), SECRET, NOW))
                .doesNotThrowAnyException();
    }

    @Test void acceptsAnyMatchingV1Entry() {
        String header = "t=" + NOW + ",v1=" + "0".repeat(64) + "," + signature(NOW, PAYLOAD).split(",")[1];
        assertThatCode(() -> StripeGateway.verifySignature(PAYLOAD, header, SECRET, NOW)).doesNotThrowAnyException();
    }

    @Test void rejectsTamperedPayload() {
        assertThatThrownBy(() -> StripeGateway.verifySignature("{}".getBytes(StandardCharsets.UTF_8),
                signature(NOW, PAYLOAD), SECRET, NOW))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.getCode()).isEqualTo("INVALID_SIGNATURE"));
    }

    @Test void rejectsStaleTimestampBeyondTolerance() {
        assertThatThrownBy(() -> StripeGateway.verifySignature(PAYLOAD, signature(NOW, PAYLOAD), SECRET, NOW + 301))
                .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.getCode()).isEqualTo("INVALID_SIGNATURE"));
    }

    @Test void rejectsMissingOrMalformedHeader() {
        for (String header : new String[]{null, "", "t=abc,v1=00", "v1=" + "0".repeat(64), "t=" + NOW}) {
            assertThatThrownBy(() -> StripeGateway.verifySignature(PAYLOAD, header, SECRET, NOW))
                    .isInstanceOfSatisfying(BusinessFailure.class, error -> assertThat(error.getCode()).isEqualTo("INVALID_SIGNATURE"));
        }
    }
}
