# M10-b：schema、Flyway与本人读取

关联FR09／13／14、NFR06—09及T51-C01／03／11。前置M10-a／c已确认Java启动、PG18与Redis认证；M03 Vue未实施，因此本片完成Java侧也不等于M10整体或G2通过。比较点为HEAD3a3e056与本轮yingxiang-m10b-baseline-*临时指纹。

目标：显式运维命令预检／迁移／校验PG的yingxiang_migration schema；Flyway V1保留SQLite0006的现行表结构／稳定ID／毫秒和整数记账语义，不导入真实数据。API启动不运行Flyway，禁止clean／baseline掩盖未知库。预检只输出数量和权限布尔，不输出表内容／凭据。

在维护模式下仅打开GET／HEAD /api/account/me：匿名空视图、首个Cookie／无URL解码／SHA256会话摘要、过期／停用／角色当次读取、本人权益和最近记录，与FastAPI合成合同对照。Spring Security保持无状态，不创建JSESSIONID或默认账号；其他业务仍503。缺schema／数据库失败返回受控503，ready不得代表全量业务完成。

实现范围为backend的Java、Flyway SQL、运维／对照脚本及测试、相关文档；原FastAPI／SQLite和前端入口不切换，不调用模型／支付。第一版读取使用已有Spring JDBC，JPA映射不作为此只读片的前置，后续持久层选择要记录兼容验证。

先预检库、目标schema和权限；目标未知／非空无Flyway历史时停止，不覆盖或baseline。明确migrate命令才创建目标schema／表；不修改public中的业务表。测试只在独立临时schema写合成数据，结束删除自己创建且带本轮随机标记的schema，不执行Flyway clean。

验证包含V1字段／约束对照、实际PG的Flyway重复执行／校验、合成账号／会话／余额／历史的真实HTTP与旧后端对照、重复Cookie／越权归属／过期／停用、数据库失败和写入口关闭。原有账号不自动导入；无独立迁移／运行凭据时使用用户给定账号完成开发验证并明确记录，不能宣称生产最小权限达标。

状态见05，证据见reports；未获用户明确审核不得commit／push。本片不完成Vue入口联调、登录注册／赠送、生产角色分离或全量迁移。
