package cn.yingxiang.exception;

/**
 * 通用错误码。
 *
 * <p>区间约定：0 成功；4xxxx 请求方问题；5xxxx 服务端问题。
 * 细分业务原因通过 {@link BusinessException#getReason()} 传递，不复用这里的码值。</p>
 */
public enum ErrorCode {

    SUCCESS(0, "ok"),
    PARAMS_ERROR(40000, "参数错误"),
    NOT_LOGIN_ERROR(40100, "尚未登录"),
    LOGINED_ERROR(40101, "已经登录"),
    NO_AUTH_ERROR(40102, "无权限执行该操作"),
    FORBIDDEN_ERROR(40300, "禁止访问"),
    NOT_FOUND_ERROR(40400, "资源不存在"),
    METHOD_NOT_ALLOWED_ERROR(40500, "请求方法不被允许"),
    CONFLICT_ERROR(40900, "资源状态冲突"),
    PAYLOAD_TOO_LARGE_ERROR(41300, "请求内容过大"),
    UNSUPPORTED_MEDIA_TYPE_ERROR(41500, "请求格式不支持"),
    SYSTEM_ERROR(50000, "系统内部错误"),
    OPERATION_ERROR(50001, "操作失败"),
    SERVICE_UNAVAILABLE_ERROR(50300, "服务暂不可用");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    /** 由 HTTP 状态推导通用错误码，供统一异常边界复用。 */
    public static ErrorCode fromStatus(int status) {
        return switch (status) {
            case 400 -> PARAMS_ERROR;
            case 401 -> NOT_LOGIN_ERROR;
            case 403 -> FORBIDDEN_ERROR;
            case 404 -> NOT_FOUND_ERROR;
            case 405 -> METHOD_NOT_ALLOWED_ERROR;
            case 409 -> CONFLICT_ERROR;
            case 413 -> PAYLOAD_TOO_LARGE_ERROR;
            case 415 -> UNSUPPORTED_MEDIA_TYPE_ERROR;
            case 503 -> SERVICE_UNAVAILABLE_ERROR;
            default -> status >= 500 ? SYSTEM_ERROR : OPERATION_ERROR;
        };
    }
}
