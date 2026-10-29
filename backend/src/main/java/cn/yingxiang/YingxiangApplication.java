package cn.yingxiang;

import cn.yingxiang.worker.WorkerService;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class YingxiangApplication {
    public static void main(String[] args) {
        System.setProperty("jdk.httpclient.disableRetryConnect", "true");
        System.setProperty("jdk.httpclient.enableAllMethodRetry", "false");
        SpringApplication app = new SpringApplication(YingxiangApplication.class);
        app.addListeners((org.springframework.context.ApplicationListener<org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent>) event -> {
            if ("worker".equals(event.getEnvironment().getProperty("migration.role", "api"))) {
                if (event.getEnvironment().getActiveProfiles().length == 0)
                    event.getEnvironment().setActiveProfiles("local");
                app.setWebApplicationType(org.springframework.boot.WebApplicationType.NONE);
            }
        });
        var context = app.run(args);
        if ("worker".equals(context.getEnvironment().getProperty("migration.role", "api"))
                && context.getBeansOfType(WorkerService.class).isEmpty())
            throw new IllegalStateException("Worker service missing; profiles=" + java.util.Arrays.toString(context.getEnvironment().getActiveProfiles()));
    }
}
