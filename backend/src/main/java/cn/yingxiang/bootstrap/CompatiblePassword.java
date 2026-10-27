package cn.yingxiang.bootstrap;

import org.bouncycastle.crypto.generators.SCrypt;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public final class CompatiblePassword {
    private static final Semaphore SLOTS = new Semaphore(2, true);
    private CompatiblePassword() {}

    static byte[] nodeUtf8(String value) {
        StringBuilder normalized = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char current = value.charAt(i);
            if (Character.isHighSurrogate(current)) {
                if (i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) {
                    normalized.append(current).append(value.charAt(++i));
                } else normalized.append('\uFFFD');
            } else normalized.append(Character.isLowSurrogate(current) ? '\uFFFD' : current);
        }
        return normalized.toString().getBytes(StandardCharsets.UTF_8);
    }

    public static String hash(String password, String salt) {
        boolean acquired = false;
        byte[] bytes = nodeUtf8(password);
        try {
            acquired = SLOTS.tryAcquire(2, TimeUnit.SECONDS);
            if (!acquired) throw BusinessFailure.unavailable();
            byte[] derived = SCrypt.generate(bytes, salt.getBytes(StandardCharsets.UTF_8), 16384, 8, 1, 64);
            try { return HexFormat.of().formatHex(derived); }
            finally { java.util.Arrays.fill(derived, (byte) 0); }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt(); throw BusinessFailure.unavailable();
        } finally {
            java.util.Arrays.fill(bytes, (byte) 0);
            if (acquired) SLOTS.release();
        }
    }

    public static boolean equal(String actual, String expected) {
        return MessageDigest.isEqual(actual.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
    }
}
