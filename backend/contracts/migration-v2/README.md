# 当前架构迁移合同（冻结基线）

关联M01、T51-C01／C03／C04／C05／C07，源schema revision0006。`http-fixtures.json`冻结当前FastAPI实现的70个代表HTTP交互、100项方法／路径清单和OpenAPI语义摘要；样本全部合成，供应商均为替身。

```powershell
# 在backend/执行；常规命令只核对，不改fixture
.venv/Scripts/python.exe -m scripts.migration_contracts
.venv/Scripts/python.exe -m pytest tests/test_migration_contract_v2.py
```

捕获器只使用新临时库和用户目录，拦截Settings.load及HTTPX真实网络传输。Windows asyncio所需的回环IPC允许，外部socket连接拒绝。模型调用为一次进程内超时替身，Stripe为一次本地创建替身；两者均为合成计数，不代表真实调用／付款。

覆盖：当前关闭的旧接口、Origin／格式拒绝、账号Cookie属性／HEAD／OPTIONS、unknown重试不重复签发、沙盒查单重复不重复发放且不增加真实次数、分片顺序／重传／冲突、参考图、提示词历史／冲突、Range／If-Range／HEAD／下载、收藏／搜索、跨账号和删除后的拒绝。

规范化规则：随机UUID为逐一稳定别名，保留不同用户／资源之间的区别；requestId单独标识；仅符合UTC毫秒格式的时间值规范化，格式变化不会被掩盖；access／Cookie值不保存，只保留Cookie属性。文件记录字节数／SHA256；ETag与Last-Modified的值是易变字段，但存在性及If-Range行为实际核对。请求密码仅为脱敏占位；源驱动中的密码和提示词均为合成样本。

清单来自公开OpenAPI及实际根路由注册项。schema未列出的嵌套隐式方法不能仅凭清单认定全覆盖；其他管理写入、视频提交、预算和崩溃恢复继续由原后端业务测试验证。原 `contracts/http-fixtures.json` 的29条Node迁移期样本不变，不能用旧样本冒充当前保存／积分合同。

`--write`只用于显式建立／复核已决定的合同增量，常规检查不调用。未来Vue／Java应与这份固定行为对照，不能因新实现失败就重新录制“通过”。Spring生成的OpenAPI允许工具元数据不同，需对路径／方法／字段／约束做语义核对；本文件中的源OpenAPI摘要仅标识旧基线，不要求Java产生字节相同的文档。
