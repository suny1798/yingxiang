# M10-c：Java连接专项与本机配置

父片M10，关联FR09／10、NFR06—09及T51-C01／C03／C11／C12中的配置隔离和连接部分；状态统一见05。前置M10-a已完成，真实业务迁移仍未实施。

用户要求参考本机picture项目的application.yml及application-local.yml：采用公共配置／本机覆盖、统一/api入口；允许MySQL5.7或PG。沿用既定PostgreSQL主库，不同时接两套业务数据库；MySQL仅为备选，正式改选时补方言／锁／迁移决策。

比较点为HEAD3a3e056及本轮临时指纹yingxiang-java-connectivity-baseline-*。允许修改backend Java配置／连接工具／相关测试与说明、05和16；不改变参考项目文件，不自动提交。

本机凭据置于backend/config/application-local.yml，Git忽略且不进入src/main/resources或Jar。公共配置只放运行默认值；默认local直接导入；显式offline不读本机覆盖并排除JDBC／Redis自动配置。接口上下文/api，既有冻结API路径不重复加前缀，内部健康入口变为/api/internal/*。

用Maven管理的JDBC／Lettuce一次验证已填PG／Redis连接。PG仅只读事务查询版本、目标库是否匹配、schema是否存在与只读状态；Redis仅连接认证和PING，不读写业务键，不测试命名空间写权限。按用户指定现成项目的实际连接方式读取协议配置，PG当前sslmode=disable、Redis ssl.enabled=false，不硬编码强制TLS；不改宝塔／SSH，不执行DDL、Flyway或真实模型／支付。

有限超时、禁止重连，单次命令由外层45秒截止；输出仅固定分类／布尔／版本，不输出主机、用户名、密码、原始异常或完整配置。失败记录原因并停止真实重试；认证／权限未到达时不能声称已验证。

验证：Maven verify、最终Jar隔离HTTP及错误配置回归、连接分类／配置校验测试、Jar无私有配置检查；最后运行一次真实连接并记录脱敏结果。若认证或目标库／schema条件未满足，连接依赖保留，继续完成不依赖云库的配置工作，不冒称M10或G2完成。

用户后续确认PG数据库名与用户名均为yingxiang，按该值读取本机配置，不再强制库名包含migration；schema仍为独立的yingxiang_migration。当前PG认证／只读查询及Redis认证／PING通过，schema不存在；只读检查不自动创建。最新结果见配置修正报告。
