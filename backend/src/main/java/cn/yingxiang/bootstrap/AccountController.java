package cn.yingxiang.bootstrap;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("local")
public class AccountController {
    @GetMapping("/account/me")
    public Object me(HttpServletRequest request) {
        Object view = request.getAttribute("yingxiang.accountView");
        if (view == null) throw new IllegalStateException("Missing account authentication context");
        return view;
    }
}
