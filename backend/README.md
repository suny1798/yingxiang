# 映想后端

## Java项目配置与启动

已按用户指定的picture可运行项目适配，使用当前JDK21／Spring Boot4.1.2。Maven引入 `spring-boot-starter-jdbc` 与 `spring-boot-starter-data-redis`，由Spring自动装配Hikari数据源、RedisConnectionFactory与StringRedisTemplate；PG驱动42.7.14与Lettuce7.5.2.RELEASE由Boot BOM管理。

配置入口：

- `src/main/resources/application.yml`：公共配置，默认local，回环端口8792，统一 `/api` 上下文。
- `src/main/resources/application-local.yml`：本机覆盖导入入口，不在此填密码。
- `config/application-local.yml`：本机真实连接参数，已适配参考项目Redis连接信息；PG库名与用户名均为用户指定的 `yingxiang`。Git忽略、不进入Jar。
- `config/application-local.example.yml`：可提交的无密钥示例。
- `src/main/resources/application-offline.yml`：显式offline时关闭数据源和Redis自动配置，供无本机配置的测试使用。

```powershell
# backend/，正常本机启动，默认读取local，无需额外profile参数
.\mvnw.cmd spring-boot:run
# 已构建时也可直接运行Jar
java -jar target/yingxiang-backend-0.1.0.jar
# 直接访问，不需要手动设置Host
curl.exe http://localhost:8792/api/internal/live
# 仅运行一次脱敏的只读连接检查
.venv/Scripts/python.exe -m scripts.java_connections
# 测试与打包；需要时用-s明确复用自己的Maven settings.xml
.\mvnw.cmd -B -ntp verify
```

已有 `/api/works` 等外部路径保持原样，不叠加前缀。local允许精确的本机localhost／127.0.0.1和配置的同源入口；不信任伪造转发头。live200只说明进程存活，ready仍503表示其余业务未完成；local下仅GET／HEAD /api/account/me已迁移，其余业务继续关闭。

Redis沿用参考项目的host／port／password与未启用TLS的实际设置；Boot版本差异仅将 `spring.redis` 映射到 `spring.data.redis`。PG的sslmode从私有YAML读取，本机目前为disable，不再被检查工具硬编码覆盖。没有接入picture业务库、分库分表、COS密钥或其认证／Session实现，也没有切换现有FastAPI。MySQL5.7仍是用户允许的备选，当前主库为PG。

本机Hikari暂设最大3连接、minimum-idle0、只读及延迟初始化；SQL自动初始化关闭，不会在启动时执行DDL或Flyway。后续有写入能力时由对应迁移片调整只读角色。最新状态：PG（库名／用户名yingxiang）认证与只读查询通过，服务端18.0；Redis认证／PING通过；yingxiang_migration已由Flyway V1显式创建，19张业务表就绪，未导入真实账号。未读取业务表、未操作Redis业务键。

Java连接以 `config/application-local.yml` 为准，旧dotenv只供历史Python迁移工具使用，不做双向同步。验收与版本适配说明见[配置修正报告](../docs/reports/2026-10-27-M10-c-参考现成Java配置修正.md)。

## Flyway与本人读取（M10-b）

```powershell
# backend/；默认只预检，显式migrate才修改目标schema
.venv/Scripts/python.exe -m scripts.java_schema preflight
.venv/Scripts/python.exe -m scripts.java_schema migrate
.venv/Scripts/python.exe -m scripts.java_schema validate
# 创建随机标记的临时schema，使用合成账号与旧FastAPI对照，最后清理自建schema
.venv/Scripts/python.exe -m scripts.java_account_contracts
```

Flyway不会在API启动时自动执行，clean禁用，不会baseline未知非空目标。已应用的 `src/main/resources/db/migration/V1__current_schema.sql` 必须保持不变，后续追加V2。V1保留当前SQLite0006的19张表／字段／约束，无默认用户或自动赠送。

默认local服务的 `/api/account/me` 读取指定PG schema：兼容旧yingxiang_session摘要、首个Cookie、不解码、过期／停用／角色、本人真实权益与最近历史；匿名返回空视图。Spring Security保持无状态，不生成登录Cookie，登录／注册默认仍503，M11已提供显式开启的开发路径。数据库缺表或不可用返回受控503；整体ready503继续保留。目标schema不初始化测试账号，真实账号导入另行执行。

当前开发迁移与运行仍使用用户提供的同一登录，生产运行／迁移凭据尚未分离；本机Hikari只读不是权限隔离的替代。本轮15组JUnit、23项真实PG／Jar与FastAPI对照通过；Vue同源入口及M10整体未完成。详见[M10-b报告](../docs/reports/2026-10-27-M10-b-Flyway与本人读取.md)。

## Java账号写入（M11，默认关闭）

已实现POST `/api/account/register`、`login`、`logout`：兼容旧scrypt摘要、用户名／密码规则、7天Cookie、一次免费赠送、注销与持久限流。BC1.86使用固定旧参数，scrypt在事务外执行。注册的用户、grant、流水和会话原子提交；失败计数用独立事务保存。

默认 `migration.auth-enabled=false`、维护true、Hikari只读，目标库不会自动注册测试账号。测试与手动开启方式：

```powershell
# backend/；53项合同与故障检查，自动使用随机临时schema，结束清理
.venv/Scripts/python.exe -m scripts.java_auth_contracts
# 显式开发开启：指向当前本机YAML的目标schema，会允许真实账号写入
java -jar target/yingxiang-backend-0.1.0.jar --migration.auth-enabled=true --migration.maintenance=false --spring.datasource.hikari.read-only=false
```

账号写入需要local、显式auth开关、关闭维护与可写数据源；维护开启时仍返回503 MAINTENANCE，其他业务写接口继续关闭。仅三条账号POST沿用严格Host／Origin／跨站检查，无须新增CSRF token；其余Spring Security保护保留。

限流按原全局60／15分、账号10／15分、注册20／小时规则保存PG窗口，Redis仅做可用性门禁；不可用时注册／登录503，本人读取仍可用。Redis脚本／ACL／窗口迁移归后续M19。正式账号导入、Vue入口及生产权限隔离未完成。证据见[M11报告](../docs/reports/2026-10-27-M11-Java登录注册与首次赠送.md)。

## 权益预留内部服务（M12-a）

新增EntitlementReservationService：本人real_usage额度原子预留、unknown占用与幂等签发确认。没有浏览器调用确认的入口，没有上游模型调用；供应商接口仍关闭。只有将来可信签发适配器验证成功后才调用confirmIssued，不能由客户端直接“确认”。

```powershell
# backend/；随机临时schema与原SQLite状态对照，两个独立JVM做竞争，结束清理
.venv/Scripts/python.exe -m scripts.java_quota_contracts
```

31项真实PG领域检查通过，覆盖最后一次竞争、沙盒／归属、unknown持久性、重复确认和异常回滚。M12完整签发／令牌校验与浏览器闭环未实现，详见[M12-a报告](../docs/reports/2026-10-27-M12-a-权益原子预留与确认.md)。

## 迁移环境配置（M02）

请在本机填写 [backend/.env.migration.local](.env.migration.local)，不要改当前运行的 `.env`。已按用户要求创建空凭据配置，并确认被Git忽略；无密钥示例为 [.env.migration.example](.env.migration.example)。填写PostgreSQL的host／port／独立测试库／schema／username／password／TLS，以及Redis的host／port／可选ACL用户名／password／TLS／测试命名空间。含特殊字符的密码按dotenv格式加引号，不把密码发到聊天或提交仓库。

```powershell
# backend/；只离线检查，尚未连接数据库／Redis
.venv/Scripts/python.exe -m scripts.migration_env
```

未填写时退出码2并只报告缺少字段；格式通过时退出0，但不等于连通性／权限／迁移已通过。此文件为历史Python工具入口，Java已改为上方的config/application-local.yml；现有FastAPI不读取该文件。不要解除维护或开启外部供应商／生成／正式支付。此历史Python检查器仍按原TLS模板校验；当前Java本机协议以用户要求参考的可运行配置及私有YAML为准。隔离库／schema／Redis前缀要求带migration标记，但命名不能替代真实的独立账号／ACL／权限隔离。

## 当前合同对照（M01）

```powershell
# backend/；临时合成库、供应商替身，常规检查不改fixture
.venv/Scripts/python.exe -m scripts.migration_contracts
```

当前冻结合同见 [contracts/migration-v2](contracts/migration-v2/README.md)；覆盖70个代表交互及100项方法／路径，原29条Node合同继续保留。没有触发真实模型或支付。

## 数据库与私有文件联合快照（M02）

新增独立命令，不改变原ops backup仅备份数据库的语义。**先停止所有API、Worker和媒体写入**，再对明确的数据根执行；`--offline`是操作者确认，命令不会替你停止服务。以下均为占位路径，不要原样执行；目标必须不存在且不能与源嵌套。

```powershell
# backend/；替换为实际已停写的数据根和全新目标
.venv/Scripts/python.exe -m scripts.joint_snapshot snapshot --source <已停写数据根> --destination <全新联合快照目录> --offline
.venv/Scripts/python.exe -m scripts.joint_snapshot verify --source <联合快照目录>
.venv/Scripts/python.exe -m scripts.joint_snapshot restore --source <联合快照目录> --destination <全新恢复数据根> --offline
```

联合快照包含SQLite和整个users子树（生成视频、参考图、prompts.json及已确认片段），不含.env、其他备份或源目录外文件。数据库完整性／外键／revision／逐表逻辑摘要及媒体SHA256一起核对；拒绝链接、覆盖、嵌套、源变化和篡改。失败目标保留INCOMPLETE，不能作为可用恢复点；不自动删除失败目录，不自动切DATA_DIR。

工具已在临时合成数据中完成恢复与故障验证，**尚未备份／恢复正式用户数据，也未验证云主库或对象存储恢复**。快照为明文，存储和异机加密／权限需由实际部署落实。磁盘故障／大容量及生产RPO／RTO不在本轮达标结论内。

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

另一个终端在 `frontend/` 执行 `npm run dev` 或构建后 `npm start`；对外入口仍为 127.0.0.1:8787。后端单 worker；不要启用 reload 处理真实业务，不配置公开监听。前端故障/后端断开不会回退旧 JSON 写入。`/api/internal/live` 与 `/api/internal/ready` 只在后端直连，前端只转发 `/api/`。

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

当前schema revision为0006。0002新增video_history只保存标题/归档，旧任务通过左连接直接出现在历史中，不回填或重置额度。历史GET/POST需登录和同源且校验所有者；归档不删除任务、不释放预算，活动/未知任务不可归档；作品媒体保存后来由0005增加。

旧0001升级：先停后端写入，运行`python -m scripts.ops backup --destination backups/指定新备份.sqlite3`，再`python -m alembic upgrade head`和`python -m scripts.ops check`，成功后重启。不能改已部署0001或通过downgrade删除业务数据。本机本轮备份pre-video-history-20261024.sqlite3；13张原表行数和内容指纹均保持一致。

## 长期有效积分包与0003升级

0003增加独立sandbox_credit_packs及积分订单字段；升级在事务中保存/重建payment_events依赖并恢复全部事件，保留旧订单字段和请求快照。不更改0001/0002。先停写、备份，再upgrade head和ops check，成功后重启；本轮备份backups/pre-credit-packages-20261025.sqlite3，14张原业务表逐字段比对一致，完整性与外键检查通过。

credits-v1-light/creator/plus支持沙盒Checkout、验签回调/主动查单和原子幂等积分发放。积分不设到期；测试包保存在独立表，真实模型额度不读它。Checkout链接超时仍保留。/api/payments/orders与reconcile新增sandboxPointBalance、sandboxCreditPacks；旧sandboxCredits仍表示旧次数包。客户端只提交SKU，不能自报价格。正式支付仍关闭。


## 提示词未知签发恢复（2026-10-25）

提示词unknown不再永久锁住整个场景：保留原申请、US$0.30风险占用和次数，等待max(创建+60秒、最后更新+60秒、lease_until)后，可由用户手动新开。旧UUID永远不能再签发，预算/次数/白名单/暂停及活动lease仍约束；预留缺失或不足继续失败关闭。此规则只适用于固定10秒TTL/15秒会话的prompt，不适用于视频任务。等待结束不代表实际零收费或核对完成。无需删库、清记录、补额度或人工改issued。

今后签发失败会在当前申请observation保存固定tokenFailure类别与HTTP状态，不保存原响应、密钥、提示词、媒体或完整异常。历史unknown没有该诊断时不能推断失败原因。


## 当前账号不限次实时编辑（用户明确要求，2026-10-25）

本机YINGXIANG_PROMPT_UNLIMITED_USERNAMES=suny。该账号登录并通过原场景名单后，可连续手动新开，不检查累计预算/次数、unknown等待或旧lease冷却。不是将上限改成巨大数字；不需要清除账本。预算预留与申请继续保留用于追踪，管理页上限为null。普通未配置账号及视频保持原门禁，服务开关/主动暂停仍生效；不自动测试或生成。该配置覆盖上文针对suny实时编辑的US$5/20次/60秒等待说明。


## 令牌时限校验（2026-10-25修复）

令牌请求TTL保持10秒；本站在响应接收后校验尚未过期且剩余不超过15秒（含既有5秒时钟裕量），避免旧requestStart+15秒误拦。长期密钥、模型/来源和会话时长检查保留；错误代码细分到具体字段。受限账号lease为45秒覆盖签发/有效期/会话，suny不限次配置继续跳过等待。不得用取消校验来处理INVALID_PERMISSIONS，历史错误无法在没有返回字段时精确回溯。


## 作品文件与后台保存（0005，2026-10-26）

用户已授权默认保存生成结果及实际使用的服装参考图，覆盖旧仅内存媒体规则。文件单独存放在`DATA_DIR/users/<userUUID>/works/<workUUID>/`；不把用户名、文件名或URL用作目录。`works`与`work_references`只存索引，不在SQLite写入媒体。不能将此路径挂到静态服务；浏览器通过本人`/api/works`接口访问，视频支持Range。文件原子发布后才标记ready，临时分片/下载文件不提供读取。实时流分片总上限32MiB、参考图单张10MiB/每作品24张、供应商结果200MiB，仅技术文件上限，不改变测试次数/预算。

单worker生命周期内启动后台保存任务；只查询既有provider_id与GET结果，不新建模型任务。视频排队/保存状态在SQLite，重启继续；下载最多3次后failed，用户可主动重试保存。实时录制离开页面仍提交最后片段；断开超过120秒后合并已确认片段并提示中断，不保证未上传数据可恢复。参考图按实际使用顺序关联作品，保存失败明确提示，不伪造为已保存。原人物视频、相机原画和提示词不持久保存。

维护时先停止后端写入，再备份SQLite与整个`data/users`目录，两者需同一静止时点；`scripts.ops backup`仍只备份数据库，不能当作媒体备份。恢复两者后运行完整性检查，并抽查ready作品及所有参考文件存在。本机升级前备份`data/backups/pre-works-0005-20261026.sqlite3`，17张旧业务表原字段逐行一致。删除作品清除其视频/参考文件，索引保留最少tombstone去重，避免后台重新创建；不删除模型任务/预算流水。


## 作品收藏与检索（0006，2026-10-27）

`GET /api/works`新增标题关键词`q`、`favorite=true`与`sort=newest|oldest|title`，所有过滤/排序在本人完整作品集合执行后再分页；搜索按字面值转义通配符，排序使用固定白名单和稳定ID次序。`POST /api/works/{id}`接受`{favorite:boolean}`，收藏按账号保存在works索引，不改updatedAt或保存队列时间。0006仅以SQLite原生ADD COLUMN增加`favorite`（默认0、CHECK 0/1）并建立user/favorite/created_at索引，不重建作品表或媒体目录。

本机升级前在服务未运行状态备份至`backups/pre-work-favorites-20261027.sqlite3`，执行`ops init`和`ops check`；revision 0005→0006，作品/账号计数、旧字段、外键和完整性检查通过，原有作品全部默认为未收藏。回退需使用数据库备份并同时核对`data/users`；不能仅降级代码，因为旧revision不会被当前readiness接受。
