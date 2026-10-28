# M08-a：Vue视频换装提交与结果

前置M05本机视频预览、M06本人作品和M07实时换装通过；当前状态只在05维护。关联FR23/24/31/46、T51-C05—C07，按16附录A.4实施。沿用当前worktree/frontend，原工作区及正式入口不切换。

## 输入与行为切片

/studio/video在保留M05-a3本机选片、MP4校验、静音预览与画面工具的基础上，接入既有视频任务合同：

- GET `/api/video/jobs` 读取本人服务状态和最近任务；POST `/api/video/jobs` 以multipart提交`data`、`reference_image`、`consentVersion`，请求头`X-Video-Attempt`；GET `/api/video/jobs/{id}` 轮询；completed后经`/api/video/jobs/{id}/content?v=...`播放结果。
- 登录门禁与云端处理确认；未登录先打开账号弹窗，不自动上传或提交。服务不可用时显示原提示，不绕过。
- 检测到音轨时在提交前调用既有`prepareVideo`（POST `/api/video/prepare`）移除音轨，显示真实上传／处理／接收进度并可取消；无音轨直接使用原文件。准备结果只用于本次提交，不替换本机预览，也不放宽本机校验。
- 提交网络未知只提示“提交结果尚未确认，请刷新任务核查，不要再次生成”，随后只读列表恢复同一提交编号；不自动重试、不重复POST。
- 仅页面可见时约4秒轮询，聚焦可刷新；pending/processing/completed/failed/unknown显示原状态。completed可播放、切原视频／换装结果、全屏、当前帧PNG及镜像下载；失败／过期显示固定原错误。返回创作回到本机预览。
- 账号世代经SessionScope隔离；退出、换账号、切后台或卸载取消在途读取、准备、提交、轮询与导出，旧账号迟到结果不进入新账号。结果由后端默认保存到本人作品，页面提供“我的作品”入口；本片不新增后端保存逻辑。
- 不采集音频、不自动录制、不自动提交；真实模型、Stripe和供应商仍不调用。

## 验收

- 单测覆盖服务读取、提交成功、网络未知不重试、轮询完成／失败、不可见不轮询、换账号丢弃迟到结果、卸载取消、含音轨准备与取消。
- 浏览器在1440×1000桌面使用临时SQLite旧FastAPI、合成账号及明确路由替身`/api/video/prepare`、`/api/video/jobs`、`/api/video/jobs/{id}`、`/api/video/jobs/{id}/content`，验证登录门禁、选片+服装、准备进度／取消、仅一次提交、unknown提示与列表恢复、processing→completed、结果播放／全屏／PNG／镜像下载、返回创作、离开停止轮询及无模型／支付mutation。
- 既有local-studio、local-studio-tools、local-video-studio、studio-session、works-index桌面脚本回归；`npm run check`、`legacy:typecheck`、`npm run smoke`通过。

## 边界

- 浏览器中的准备／任务／结果均为合成MP4与路由替身；没有真实模型出画、真实供应商unknown、真实音轨移除或真实后端自动保存结论。
- Playwright路由替身下只观察到上传阶段进度，处理／接收阶段的切换由既有`video-prepare`单测覆盖；不把替身观察写成真实处理已验证。
- 不修改API、数据库、权益或正式作品；不切正式入口、不push。M08-b提示词组合／实时编辑、M09入口与G1仍独立验收。
