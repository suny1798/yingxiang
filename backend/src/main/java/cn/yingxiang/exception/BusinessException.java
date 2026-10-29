package cn.yingxiang.exception;

/**
 * 可预期的业务异常。
 *
 * <p>{@code code} 为对外通用错误码，{@code reason} 为后端细分原因，
 * {@code status} 为 HTTP 状态码；默认按错误码推导。</p>
 */
public class BusinessException extends RuntimeException {

    private final int code;
    private final String reason;
    private final int status;

    public BusinessException(int code, String message) {
        this(code, message, null, statusOf(code));
    }

    public BusinessException(ErrorCode errorCode) {
        this(errorCode.getCode(), errorCode.getMessage(), errorCode.name());
    }

    public BusinessException(ErrorCode errorCode, String message) {
        this(errorCode.getCode(), message, errorCode.name());
    }

    public BusinessException(ErrorCode errorCode, String message, String reason) {
        this(errorCode.getCode(), message, reason);
    }

    public BusinessException(int code, String message, String reason) {
        this(code, message, reason, statusOf(code));
    }

    public BusinessException(int code, String message, String reason, int status) {
        super(message);
        this.code = code;
        this.reason = reason;
        this.status = status;
    }

    public int getCode() {
        return code;
    }

    public String getReason() {
        return reason;
    }

    public int getStatus() {
        return status;
    }

    /** 由通用错误码推导 HTTP 状态，避免各处硬编码。 */
    public static int statusOf(int code) {
        if (code == 0) return 200;
        int family = code / 100;
        return switch (family) {
            case 400, 401, 403, 404, 405, 409, 413, 415 -> family;
            case 500, 503 -> family;
            default -> code >= 50000 ? 500 : 400;
        };
    }
}
