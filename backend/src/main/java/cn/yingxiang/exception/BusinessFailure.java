package cn.yingxiang.exception;

/** 只保存固定的公开错误信息，禁止传入凭据或驱动异常。 */
public final class BusinessFailure extends RuntimeException {

    private final String code;
    private final int status;

    public BusinessFailure(String code, String message, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public int getStatus() {
        return status;
    }

    public static BusinessFailure unavailable() {
        return new BusinessFailure("SERVICE_UNAVAILABLE", "服务暂不可用，请刷新状态核查，不要重复提交。", 503);
    }
}
