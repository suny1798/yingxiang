# M17：Worker收取已有视频

父片M17，关联FR23／46、NFR06—08及T51-C07／08。依赖M14与M15；Vue入口、M18租约合并与正式切流未迁移。

本轮功能：页面离开后由独立Java Worker认领已存在的视频任务并保存结果。

- **持久任务**：V2新增`background_tasks`（type／user／resource／dedupe／state／attempts／maxAttempts／nextRunAt／leaseOwner／leaseUntil／leaseGeneration／lastError），以及M18／M19将使用的限流影子、故障门禁与上传槽表；不改V1既有业务表。
- **只收取、不生成**：Worker从`video_jobs`中已有`provider_id`且状态为pending／processing／completed的任务补建`works`行，按`kind,source_id`唯一去重；只GET查询状态和GET结果内容，绝不向供应商POST生成。页面／API离开不影响Worker继续保存。
- **下载与发布**：仅接受`video/mp4`或`application/octet-stream`、≤200MiB，流式写入含租约代次的临时文件，校验`ftyp`后在同一数据库事务内核对任务租约与作品状态，再原子替换`result.mp4`并置ready；临时文件不对外读取。
- **有限重试与恢复**：下载失败累计作品`retries`，最多3次后置failed／`SAVE_FAILED`；待处理任务轮询不消耗失败次数。任务与作品持久化，进程重启后继续，不重复提交生成。
- **删除收尾**：deleted作品补建cleanup任务并移除残留私有文件；删除墓碑不会被Worker复活。

验收：随机临时schema＋独立临时存储；真实PG＋独立Worker进程＋合成视频供应商；20项检查覆盖completed直接保存、pending轮询后保存、内容精确字节／哈希、失败3次有限重试、无生成POST、API停止后仍保存、重启不重复任务与不重POST。Maven 54项JUnit、M14 48项与M15 85项回归同批通过。

边界：合成供应商不证明真实视频效果／费用；真实对象存储、多机与M18租约竞争／删除竞态／片段超时未做；未接Vue，未切换8787／8788。证据见[报告](../../reports/2026-10-29-M17-Worker收取已有视频.md)。
