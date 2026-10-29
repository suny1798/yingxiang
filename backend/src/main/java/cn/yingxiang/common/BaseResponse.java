package cn.yingxiang.common;

import cn.yingxiang.exception.ErrorCode;

import java.io.Serializable;

/**
 * 统一响应包装。
 *
 * <p>JSON 接口统一返回 {@code code/data/message}；{@code requestId} 供排查使用，
 * {@code reason} 保留后端细分业务原因，不参与前端展示。</p>
 */
public class BaseResponse<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 业务状态码，0 表示成功。 */
    private int code;

    /** 业务数据。 */
    private T data;

    /** 可直接展示的结果说明。 */
    private String message;

    /** 本次请求的追踪标识，与响应头 X-Request-Id 一致。 */
    private String requestId;

    /** 细分业务原因，仅用于诊断与契约断言。 */
    private String reason;

    public BaseResponse(int code, T data, String message) {
        this(code, data, message, null, null);
    }

    public BaseResponse(int code, T data) {
        this(code, data, "");
    }

    public BaseResponse(ErrorCode errorCode) {
        this(errorCode.getCode(), null, errorCode.getMessage());
    }

    public BaseResponse(int code, T data, String message, String requestId, String reason) {
        this.code = code;
        this.data = data;
        this.message = message;
        this.requestId = requestId;
        this.reason = reason;
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }
}
