# M10-a：Java／Maven可启动底座

日期：2026-10-27。父片M10，关联NFR06—09、FR09／10及T51-C01／C03／C11／C12；状态以05为准。

## 当前范围与依赖

用户明确要求先暂停云PG／Redis连接排查，等Java工程启动后用Maven依赖验证。本子片提前搭建无数据库依赖的启动底座；它不替代M03，也不将M10“PG本人读取闭环”标为完成。M00／M01和现有JDK21／Maven条件已满足；真实PG／Redis连接不作为本子片启动依赖。

在backend原目录增加pom、官方Maven Wrapper、src/main／test。保留app／migrations／Python脚本、SQLite及当前前端，Java单独监听回环8792；不代理或切流现有8787／8788，不读原业务.env或私有数据。

## 交付行为

- Maven Wrapper可构建、测试和生成可执行Jar；依赖精确固定，目标Java21。
- 默认offline启动，不加载云连接文件、不创建连接池／建库／执行Flyway；长期密钥不会进入配置示例或日志。
- /internal/live仅证明Java进程存活；/internal/ready明确503，不能冒称数据库及业务已就绪。
- 全部当前已知业务API保持503 SERVICE_DISABLED；未知API404、不支持方法405，错误维持error／requestId结构、no-store／nosniff。不生成默认用户、JSESSIONID或Basic／登录跳转。
- 保留精确Host／Origin与跨站拒绝；不信任伪造转发头，不把未实现API变成可用Mock服务。
- 真实HTTP验证健康、错误、HEAD、来源与Cookie属性；Maven测试使用合成请求，不连接任何远端。

## 验证与停止条件

先建立可重复的HTTP边界测试和默认安全配置测试，再运行Wrapper verify与Jar实际启动测试。启动profile错误、维护关闭、供应商／生成开关开启、非回环监听等不满足当前隔离范围时必须拒绝，而非静默启动。

具体版本以本轮官方文档／Maven Central及最终构建为证据；不因建工程升级Decart／Stripe或Python依赖。依赖下载失败只限制相关Java步骤，不改全局Maven镜像或现有账号配置。Git不自动提交。

下一步M10-b接兼容身份和Flyway／PG本人读取；真实连接测试使用Java驱动并保留现有TLS设置，禁止在本子片重新探测SSH或改为公网明文认证。
