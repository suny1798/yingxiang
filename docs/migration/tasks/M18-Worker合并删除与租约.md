# M18：Worker合并删除与租约

父片M18，关联FR11／46、NFR06—08及T51-C07／08／10。依赖M16与M17；Vue入口、M19 Redis门禁与正式切流未迁移。

本轮功能：两个独立Worker在真实PG上竞争、失租、旧代次与删除竞态下仍不重复生成、不复活作品。

- **双认领与租约**：`background_tasks`以`FOR UPDATE SKIP LOCKED`短事务认领，写owner／leaseUntil／递增`leaseGeneration`后提交；执行网络／文件工作时不持有数据库事务。
- **旧代次不发布**：下载临时文件包含代次；发布前在同一事务内以task id＋owner＋generation＋未过期租约和作品状态做条件核对，旧Worker不能覆盖最终`result.mp4`，失租任务不重排新代次。
- **删除竞态**：下载中作品被置删除墓碑时，Worker删除临时文件、取消保存任务，并补建cleanup任务清除残留；删除状态不被复活，最终文件不出现。
- **片段超时部分保存**：capturing超过配置阈值（默认120秒）无新片段时，条件更新为saving并保留`PARTIAL_CAPTURE`，由capture-finish任务拼接已确认分片；空片段直接failed／`CAPTURE_EMPTY`。
- **不重复生成**：所有路径只GET已有任务状态／结果，供应商POST计数保持0。

验收：随机临时schema＋独立临时存储；真实PG＋两个独立Worker进程＋合成供应商；15项检查覆盖双认领／代次推进／旧代次不发布、删除竞态取消与清理、片段超时部分保存、单一capture-finish任务、全程0生成POST。Maven verify、M17 20项与M14／M15回归同批通过。

边界：合成供应商与合成片段不证明真实效果／费用；真实对象存储、多机与M19 Redis门禁未做；未接Vue，未切换8787／8788。证据见[报告](../../reports/2026-10-29-M18-Worker合并删除与租约.md)。
