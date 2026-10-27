# M11：Java登录、注册与首次赠送

关联FR09／13／14、NFR06—09与T51-C01／03／04／11。M10 Java读取、PG／Redis连接及V1已验证；Vue同源入口尚未迁移，本片继续Java优先的独立子片，不标M10整体或G2完成。比较点为HEAD3a3e056及本轮yingxiang-m11-baseline-*指纹；状态见05。

实现POST account/register／login／logout，与旧FastAPI对照：账户字段／长度／小写、原scrypt参数和Node UTF8替换规则、首个Cookie、7天与Secure标志、受控JSON／Origin／维护状态。Spring Security仅对三条旧写接口沿用已有精确Host／Origin／跨站保护，不要求新客户端CSRF token；其他接口保护不豁免。

注册的用户／一次15秒免费grant／流水／会话在同一事务内，唯一冲突全部回滚。scrypt在事务外，有限并发与等待。限流使用PG持久窗口与原全局60／15分、单账号10／15分、注册20／小时规则，独立事务提交；Redis仅做本片可用性门禁，故障关闭登录注册，窗口丢失不使PG计数归零。Redis脚本及窗口迁移仍归M19，不提前宣称完成。

默认auth-enabled=false、维护true、数据源只读；只有显式打开auth、关闭维护并使用可写数据源才测试写入。真实schema不写合成账户，所有注册／竞争／撤销和故障测试在随机且有所有权标记的临时schema执行，结束删除自建schema。不改V1已应用SQL、不导入真实账号、不触发供应商／支付、不改集群角色和原FastAPI入口。

验证：Python合成摘要向量跨语言测试，Maven verify；真实Jar／PG与合成SQLite旧后端的错误与成功合同、Cookie、注销、旧摘要登录；并发同名注册只赠送一次、失败计数不回滚、Redis故障关闭、维护状态及事务失败回滚。只输出分类和计数，不打印密码／cookie／摘要或完整SQL异常。

运行／迁移凭据分离、Vue入口和生产发布不在本片达标声明内；没有用户明确审核不commit／push。
