package cn.yingxiang.bootstrap;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.data.redis.autoconfigure.DataRedisAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import javax.sql.DataSource;
import static org.assertj.core.api.Assertions.assertThat;

class LocalInfrastructureTest {
    @Test void referenceStylePropertiesWireRealSpringInfrastructureWithoutNetwork() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class, DataRedisAutoConfiguration.class))
                .withPropertyValues(
                        "spring.datasource.url=jdbc:postgresql://db.invalid:5432/yingxiang_migration_test",
                        "spring.datasource.username=synthetic_user", "spring.datasource.password=synthetic_password",
                        "spring.datasource.hikari.data-source-properties.sslmode=disable",
                        "spring.datasource.hikari.minimum-idle=0", "spring.datasource.hikari.initialization-fail-timeout=-1",
                        "spring.datasource.hikari.read-only=true",
                        "spring.data.redis.host=redis.invalid", "spring.data.redis.port=6379",
                        "spring.data.redis.password=synthetic_password", "spring.data.redis.ssl.enabled=false",
                        "spring.data.redis.database=0", "spring.data.redis.timeout=5s")
                .run(context -> {
                    assertThat(context).hasSingleBean(DataSource.class).hasSingleBean(StringRedisTemplate.class);
                    var dataSource = (HikariDataSource) context.getBean(DataSource.class);
                    assertThat(dataSource.getJdbcUrl()).contains("yingxiang_migration_test");
                    assertThat(dataSource.getDataSourceProperties().getProperty("sslmode")).isEqualTo("disable");
                    assertThat(dataSource.isReadOnly()).isTrue();
                    var redis = context.getBean(LettuceConnectionFactory.class);
                    assertThat(redis.getHostName()).isEqualTo("redis.invalid");
                    assertThat(redis.getClientConfiguration().isUseSsl()).isFalse();
                    assertThat(redis.getDatabase()).isZero();
                });
    }
}
