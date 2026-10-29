package cn.yingxiang.exception;

import cn.yingxiang.common.BaseResponse;
import cn.yingxiang.common.ResultUtils;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 全局异常处理器：把异常统一转换为 {@link BaseResponse}。
 *
 * <p>只记录固定摘要，不打印请求体、Cookie 或令牌；未知异常一律按服务端错误处理。</p>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 迁移期既有业务异常：保留原 HTTP 状态与细分原因。 */
    @ExceptionHandler(BusinessFailure.class)
    public ResponseEntity<BaseResponse<?>> businessFailure(BusinessFailure error, HttpServletResponse response) {
        log.warn("BusinessFailure reason={} status={}", error.getCode(), error.getStatus());
        return entity(error.getStatus(), error.getCode(), error.getMessage(), response);
    }

    /** 新代码统一使用的业务异常。 */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<BaseResponse<?>> businessException(BusinessException error, HttpServletResponse response) {
        log.warn("BusinessException code={} reason={}", error.getCode(), error.getReason());
        BaseResponse<?> body = ResultUtils.error(error.getCode(), error.getMessage(), error.getReason());
        body.setRequestId(requestId(response));
        return ResponseEntity.status(error.getStatus()).body(body);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, HttpMessageNotReadableException.class,
            IllegalArgumentException.class})
    public ResponseEntity<BaseResponse<?>> badRequest(Exception error, HttpServletResponse response) {
        log.warn("Bad request type={}", error.getClass().getSimpleName());
        return entity(HttpStatus.BAD_REQUEST.value(), ErrorCode.PARAMS_ERROR.name(), "请求参数不正确。", response);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<BaseResponse<?>> methodNotAllowed(HttpServletResponse response) {
        return entity(HttpStatus.METHOD_NOT_ALLOWED.value(), ErrorCode.METHOD_NOT_ALLOWED_ERROR.name(), "请求方法不被允许。", response);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<BaseResponse<?>> notFound(HttpServletResponse response) {
        return entity(HttpStatus.NOT_FOUND.value(), ErrorCode.NOT_FOUND_ERROR.name(), "资源不存在。", response);
    }

    /** 兜底：不回显异常信息与堆栈。 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<BaseResponse<?>> unexpected(HttpServletResponse response) {
        log.error("Unhandled exception");
        return entity(HttpStatus.INTERNAL_SERVER_ERROR.value(), ErrorCode.SYSTEM_ERROR.name(), "系统内部错误。", response);
    }

    private static ResponseEntity<BaseResponse<?>> entity(int status, String reason, String message,
                                                          HttpServletResponse response) {
        ErrorCode errorCode = ErrorCode.fromStatus(status);
        BaseResponse<?> body = ResultUtils.error(errorCode, message, reason);
        body.setRequestId(requestId(response));
        return ResponseEntity.status(status).body(body);
    }

    private static String requestId(HttpServletResponse response) {
        return response.getHeader("X-Request-Id");
    }
}
