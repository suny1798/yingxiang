package cn.yingxiang.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * MyBatis-Plus Mapper 注册。
 *
 * <p>offline profile 显式关闭数据源，因此也不能注册 Mapper；
 * 其余 local／正式运行按 {@code cn.yingxiang.mapper} 扫描。</p>
 */
@Configuration
@Profile("!offline")
@MapperScan("cn.yingxiang.mapper")
public class MybatisPlusConfig {
}
