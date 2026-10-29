package cn.yingxiang.common;

import cn.yingxiang.exception.ErrorCode;

/** 统一响应的构造入口。 */
public final class ResultUtils {

    private ResultUtils() {
    }

    /**
     * 成功。
     *
     * @param data 业务数据
     */
    public static <T> BaseResponse<T> success(T data) {
        return new BaseResponse<>(ErrorCode.SUCCESS.getCode(), data, ErrorCode.SUCCESS.getMessage());
    }

    /** 成功且无数据。 */
    public static BaseResponse<Void> success() {
        return success(null);
    }

    /**
     * 失败。
     *
     * @param errorCode 通用错误码
     */
    public static BaseResponse<?> error(ErrorCode errorCode) {
        return new BaseResponse<>(errorCode);
    }

    /**
     * 失败。
     *
     * @param code    错误码
     * @param message 错误信息
     */
    public static BaseResponse<?> error(int code, String message) {
        return new BaseResponse<>(code, null, message);
    }

    /**
     * 失败，并保留细分业务原因。
     *
     * @param errorCode 通用错误码
     * @param message   错误信息
     * @param reason    细分原因
     */
    public static BaseResponse<?> error(ErrorCode errorCode, String message, String reason) {
        return new BaseResponse<>(errorCode.getCode(), null, message, null, reason);
    }

    /**
     * 失败。
     *
     * @param errorCode 通用错误码
     * @param message   错误信息
     */
    public static BaseResponse<?> error(ErrorCode errorCode, String message) {
        return new BaseResponse<>(errorCode.getCode(), null, message);
    }

    /**
     * 失败，按码值与细分原因构造。
     *
     * @param code    错误码
     * @param message 错误信息
     * @param reason  细分原因
     */
    public static BaseResponse<?> error(int code, String message, String reason) {
        return new BaseResponse<>(code, null, message, null, reason);
    }
}
