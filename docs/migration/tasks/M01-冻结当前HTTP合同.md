# M01：冻结当前HTTP合同

关联FR09/10/13—16/21/31/46/49、T51-C01／C03／C04／C05／C07；前置M00已完成。实际状态只看05。

交付：在临时库、合成用户／作品、HTTPX和Stripe替身下，可重复记录并核对当前HTTP合同，含Cookie属性、HEAD／OPTIONS／Range、unknown占用、沙盒发放和跨账号拒绝。原29条Node时期fixture保留作历史对照，不覆盖它们来掩盖变化。

允许修改：backend/scripts中的离线捕获器、backend/contracts/migration-v2、必要的合同回归测试及相关文档。不修改业务接口、数据模型、实际.env或正式数据。读取main／accounts／generation／payments／works、现有test_contract／test_works和OpenAPI的相关部分。

验证入口：进程内ASGI客户端和适配器替身。真实socket外联和Settings.load均拦截；输出只保留合成合同，Cookie／门禁／令牌脱敏，二进制记录大小和摘要，不记录真实数据。UUID按稳定别名区分归属，不把所有ID合成同一占位符。

完成标准：新fixture可由显式命令在新临时库重复生成；常规检查只对照不改fixture；未知签发不重发／沙盒不增真实权益／跨用户404／分片冲突与Range有独立预期；OpenAPI及schema之外的方法清单可定位。fixture仍为选定代表场景，其他管理／视频／崩溃行为引用现有业务回归，不把新fixture数量当作全覆盖。

比较点：M00的源码快照和当前HEAD；常规漂移检查不自动接受输出。改变合同需说明FR／T、预期和兼容原因后人工更新，不能让Java改完后重录旧基线“变绿”。新命令实际实现后记录在报告。
