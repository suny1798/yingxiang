# 映想后端

## 管理权限（0004）

`/admin`复用普通账号会话，以数据库role区分user/admin；管理员导航不是鉴权边界。新建账号默认user，用户名suny本身不会自动获得权限。管理修改记录审计，不提供任意SQL/密钥编辑、媒体读取、订单改价或风险账本删除。

既有数据库升级前停止后端写入，显式备份，再运行迁移与完整性检查：

```powershell
.venv/Scripts/python.exe -m scripts.ops backup --destination data/backups/pre-admin-0004.sqlite3
.venv/Scripts/python.exe -m scripts.ops init
.venv/Scripts/python.exe -m scripts.ops check
# 仅用于明确授权的既有账号；不会创建新账号或改变其额度。
.venv/Scripts/python.exe -m scripts.ops grant-admin --username suny
```

备份目标不可覆盖，已有同名备份时选择新名称。授权命令幂等并留下`admin.bootstrap`审计，不按注册名自动提权；网页角色变更、账号暂停会撤销目标旧会话。服务暂停取消后仍受`.env`既有密钥、名单、预算和次数门禁限制。不要通过编辑角色、删除审计或清空预留来规避限制。其他管理员只能由受保护管理接口或显式本机授权配置。

FastAPI/Pydantic、同步 SQLAlchemy/Alembic、SQLite 单机持久化。网页和浏览器媒体逻辑仍在 `frontend/`；Next.js 仅转发同源 `/api/*`。所有 Python 命令在本目录执行。

## 安装与运行

本轮固定 CPython **3.13.17**（python.org 官方 Windows x64 发行版，安装器签名有效）、SQLite **3.50.4**、Windows x64。本机隔离运行时位于 `.runtime/`，不是 Git 交付物。其他机器可自行安装 Python 3.13，不要求重装全局环境；实际 sqlite/scrypt 必须检查。

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install --require-hashes -r requirements.lock.txt
Copy-Item .env.example .env
# 首次空环境才初始化；已有数据库直接 check，禁止删库或重新导入来重置额度。
.venv/Scripts/python.exe -m scripts.ops init
.venv/Scripts/python.exe -m scripts.ops check
.venv/Scripts/python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8788 --workers 1 --no-access-log --no-proxy-headers --log-level warning
```

示例默认 `MAINTENANCE=true`，准备完毕后改为 false 并重启，才能接受业务写入。不存在库/错误 revision 不会自动建库，readiness 和业务写入失败关闭。初始运行库为 `data/yingxiang.sqlite3`，与当前目录无关；显式 `DATA_DIR` 相对本目录。数据库、快照、日志和配置都不得放在 `frontend/public/`。

另一个终端在 `frontend/` 执行 `npm run dev` 或构建后 `npm start`；对外入口仍为 127.0.0.1:8787。后端单 worker；不要启用 reload 处理真实业务，不配置公开监听。前端故障/后端断开不会回退旧 JSON 写入。`/internal/live` 与 `/internal/ready` 只在后端直连，前端只转发 `/api/`。

## 数据与恢复

当前采用 SQLite **DELETE/FULL**，外键开启、busy_timeout=1000ms，写事务 BEGIN IMMEDIATE。该选择遵从用户“SQL版本怎么方便怎么来”；现成 3.50.4 不支持启用 WAL，避免已知 WAL-reset 风险。未来升级到修复运行时并验证后才可显式配置 WAL，不静默替换系统 DLL。

```powershell
.venv/Scripts/python.exe -m scripts.ops backup --destination backups/指定新文件.sqlite3
.venv/Scripts/python.exe -m scripts.ops restore --source backups/指定备份.sqlite3 --destination data/待核对恢复库.sqlite3
.venv/Scripts/python.exe -m scripts.ops snapshot --source ../frontend/.cache --destination data/指定新快照目录
.venv/Scripts/python.exe -m scripts.ops dry-run --source data/指定快照目录
# 只有停写最终快照、空目标库及完整核对通过后才执行实际导入：
.venv/Scripts/python.exe -m scripts.ops import --source data/指定快照目录
```

备份用 SQLite backup API 并做 integrity/外键检查；拒绝覆盖文件。恢复演练只能写新路径，恢复验证通过后，在维护停写期间人工切 `DATA_DIR` 并重启。保留新库和备份，禁止在新库已接受写入后直接恢复旧 JSON；优先维护并向前修复。恢复后需要补查维护期间已知 Stripe 订单，保留模型未知占用，不自动重发生成。数据库为明文，Windows 目录/备份继承当前用户权限，分发或异机保存前需另外加密。

`data/final-20261024/` 是本次停写快照，含旧配置私有备份；`backups/initial-20261024.sqlite3` 是初始导入备份。旧 `frontend/.cache` 仅作归档，不再运行写入。备份不是自动调度：目前需手工运行，不承诺 RPO/RTO 或生产容量。

## 验证与合同

```powershell
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m pip check
.venv/Scripts/python.exe -m scripts.ops openapi
# 再在 frontend/ 执行 npm run api:types 和 npm run check
```

完整依赖及哈希固定在 `requirements.lock.txt`。pytest 使用临时文件库、官方 Stripe 本地签名及 HTTPX 替身，不调用真实模型/支付。`contracts/http-fixtures.json` 的 29 个样本由迁移前 Git `d4e2328` 的实际 Next 路由在临时合成仓储中生成；动态 UUID/时间归一化，其余字段、状态、Cookie 和安全头逐项比对。合同样本不含用户数据或真实凭据。

隔离集成：`python -m scripts.prepare_integration` 在 `data/integration-frontend` 创建页面副本（目标必须不存在），连接/安装前端依赖后构建，8789 启动页面；8790 用 `scripts.integration_server:create`。在原 `frontend/` 执行 `node scripts/migration-integration.mjs`。后者固定只访问 8789，所有供应商均为进程内替身；正式服务不加载该模块。重复演练应改用新隔离目录/明确归档上一批合成数据，不借删真实账本来测试。

真实效果、相机和新增费用不因架构迁移获得验证或测试授权。提示词和视频保持原独立门禁，长期密钥只在后端。正式 Stripe 支付恒关闭。


## 含音轨视频预处理

按FR26/T28，POST /api/video/prepare接收≤25MB普通H.264 MP4，在内存中只保留视频chunk、重建offset，真实删除音频数据；不转码、不落媒体盘、不调用模型、不消耗生成次数。无需登录或模型开启，同源校验、全局30次/10分钟、共享单上传槽。返回video/mp4及X-Video-Audio-Removed。视频任务提交也调用相同逻辑兜底。特殊/碎片容器仍拒绝，不提供通用格式转换。


测试账号访问范围可配置`YINGXIANG_VIDEO_ALLOWED_USERNAMES=suny`、`YINGXIANG_PROMPT_ALLOWED_USERNAMES=suny`；逗号分隔、与库内用户名精确匹配，空值保留原全局语义。该白名单同时校验状态读取与生成预留。当前仅suny开放视频/编辑，各预算US$5、20次累计上限，保留原消费；真实新测试仍需具体素材、预算与停止条件，不由高额度自动触发。


## 视频历史管理与0002升级

当前schema revision为0002。新增video_history只保存标题/归档，旧任务通过左连接直接出现在历史中，不回填或重置额度。历史GET/POST需登录和同源且校验所有者；归档不删除任务、不释放预算，活动/未知任务不可归档。媒体仍不由后端保存。

旧0001升级：先停后端写入，运行`python -m scripts.ops backup --destination backups/指定新备份.sqlite3`，再`python -m alembic upgrade head`和`python -m scripts.ops check`，成功后重启。不能改已部署0001或通过downgrade删除业务数据。本机本轮备份pre-video-history-20261024.sqlite3；13张原表行数和内容指纹均保持一致。

## 长期有效积分包与0003升级

0003增加独立sandbox_credit_packs及积分订单字段；升级在事务中保存/重建payment_events依赖并恢复全部事件，保留旧订单字段和请求快照。不更改0001/0002。先停写、备份，再upgrade head和ops check，成功后重启；本轮备份backups/pre-credit-packages-20261025.sqlite3，14张原业务表逐字段比对一致，完整性与外键检查通过。

credits-v1-light/creator/plus支持沙盒Checkout、验签回调/主动查单和原子幂等积分发放。积分不设到期；测试包保存在独立表，真实模型额度不读它。Checkout链接超时仍保留。/api/payments/orders与reconcile新增sandboxPointBalance、sandboxCreditPacks；旧sandboxCredits仍表示旧次数包。客户端只提交SKU，不能自报价格。正式支付仍关闭。
