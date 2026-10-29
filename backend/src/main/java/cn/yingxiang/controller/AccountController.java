package cn.yingxiang.controller;

import cn.yingxiang.common.BaseResponse;
import cn.yingxiang.common.ResultUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RestController
@Profile("local")
public class AccountController {
    @GetMapping("/account/me")
    public BaseResponse<Object> me(HttpServletRequest request, HttpServletResponse response) {
        Object view = request.getAttribute("yingxiang.accountView");
        if (view == null) throw new IllegalStateException("Missing account authentication context");
        BaseResponse<Object> body = ResultUtils.success(view);
        body.setRequestId(response.getHeader("X-Request-Id"));
        return body;
    }
}
