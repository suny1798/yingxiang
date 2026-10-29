# 隔离静态入口

`nginx.local.conf.template` 供迁移验证使用，不是直接覆盖宝塔或已安装Nginx配置的文件。模板只监听回环，路径和端口由工具填充；不含账号、密钥或生产域名。

在 `frontend/` 执行：

```powershell
npm run build
# 构建末尾用本机Chromium无头浏览器预渲染六个公开页；找不到时设置实际路径
$env:YINGXIANG_CHROME_BIN = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
# 有正式公开域名时再设置，用于canonical与og:url；未设置则省略这两项
# $env:YINGXIANG_PUBLIC_ORIGIN = 'https://<公开域名>'
# nginx须在PATH；否则先指定实际可执行文件的绝对路径
$env:MIGRATION_NGINX_BIN = 'D:/Code/Tools/nginx-1.28.3/nginx.exe'
npm run smoke:nginx
```

`npm run build`先生成入口壳`dist/index.html`，再由`scripts/prerender.ts`用无头浏览器抓取六个公开路由，写出`dist/index.html`与`dist/<path>/index.html`，并把壳复制为`dist/app.html`（注入`noindex`）与`dist/entry-routes.json`。私有页与未知页面只拿到`app.html`，不预渲染私有内容；任何一页缺少标题、`lang`、正文关键文案或匿名头部都会中止构建，不生成空壳。回退到纯SPA只需把`build`改回`vite build`并恢复`try_files $uri /index.html`。

工具检查本机Nginx版本，以临时prefix／配置及随机回环端口启动Nginx和合成HTTP上游。74项断言覆盖六个公开页各自预渲染HTML与服务端标题、私有页与404的SPA壳及`X-Robots-Tag: noindex`、静态资源缓存、API原始字节／查询参数／Cookie／签名、业务拒绝、Range／HEAD、超限413和断开503。退出时只停止工具持有的进程并清理其临时目录，不执行安装目录的全局stop命令。API数据和Cookie均为合成值，真实模型与支付调用为0。

桌面走查时可运行 `node scripts/nginx-contracts.mjs --browser-window`，工具输出本次随机 `browserOrigin`，保留180秒后自动完成合同并清理。用已安装的Playwright CLI打开该地址，再执行 `run-code --filename scripts/browser/public-shell-check.js`；脚本使用当前页面的回环origin，检查六页、404、导航／偏好／前进后退及明确的公告响应替身。保持1440×1000桌面，不使用设备模拟。截图在忽略目录output/playwright；测试最后卸载Vue来验证公告清理，继续查看页面须刷新。

HTML不缓存；带构建哈希的JS／CSS／WASM一年immutable，其他assets一小时，缺失资源不回退HTML且不缓存。未知页面保留HTTP404并交给Vue显示404；未知API保留上游JSON，不落入SPA。入口检查原始Host，保留Origin交给后端验证，并重新设置Forwarded相关头；它不代替后端身份与来源授权。

当前35MiB＋4096字节是外围请求上限，逐接口上传限制仍由后端实施。130秒读写超时是空闲间隔，不是业务总截止；M09仍须处理并验证总截止及上传中断。Windows版Nginx验证不代表Linux／HTTPS生产验收；生产TLS、正式域名、进程托管、日志策略与切换另按M09／后续门槛验收。不要直接公开此本机入口。

## 正式本机入口8787（M09-d，2026-10-28起）

正式入口沿用同一模板，只是把占位符替换为本机实际值，配置与日志放在仓库外：

```powershell
# frontend/；$dir 为入口运行目录，$dist 为本次构建的绝对路径
$dir='C:/Users/sun/AppData/Local/yingxiang-entry-8787'
New-Item -ItemType Directory -Force -Path $dir,"$dir/logs","$dir/body","$dir/proxy","$dir/temp" | Out-Null
$tpl=[IO.File]::ReadAllText('deploy/nginx.local.conf.template')
$conf=$tpl.Replace('@RUNTIME@',$dir).Replace('@DIST@','<frontend/dist 绝对路径>').Replace('@PORT@','8787').Replace('@UPSTREAM@','8792')
# 实际8787入口使用master模式，支持后续reload/quit；隔离测试模板仍为单进程。
$conf=$conf.Replace('master_process off;','master_process on;')
# 必须写无BOM UTF-8，否则Nginx报unknown directive
[IO.File]::WriteAllText("$dir/nginx.conf",$conf,(New-Object System.Text.UTF8Encoding($false)))
D:/Code/Tools/nginx-1.28.3/nginx.exe -p "$dir/" -c nginx.conf -t
Start-Process 'D:/Code/Tools/nginx-1.28.3/nginx.exe' -ArgumentList '-p',"$dir/",'-c','nginx.conf' -WindowStyle Hidden
# 停止（只停本prefix，不用全局stop）
D:/Code/Tools/nginx-1.28.3/nginx.exe -p "$dir/" -c nginx.conf -s quit
```

入口只接受 `127.0.0.1:8787`／`localhost:8787`，`/api` 转发127.0.0.1:8792 Java。真实入口的只读HTTP合同：`npm run smoke:entry`（155项，不登录、不写库）；桌面走查用 `scripts/browser/entry-8787-check.js`（1440×1000，含无JavaScript六页）。旧Next入口已随M25退役，历史回退步骤只保留在[M09-d报告](../../docs/reports/2026-10-28-M09-d-前端入口切换.md)与Git标签 `archive/pre-m25`。

官方依据：[Windows注意事项](https://nginx.org/en/docs/windows.html)、[请求转发](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)、[try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。本机实测版本为1.28.3，没有升级现有安装。


2026-10-29归并后，正式8787的静态root已改为`C:/Users/sun/Desktop/anyware/frontend/dist`，`/api`当时仍转8788 FastAPI（M22已改为8792）；主进程模式已启用，155项只读入口合同通过。此前单进程配置的reload/quit未实际生效，本次先核对专属PID和完整可执行路径后仅重启该入口；旧配置备份留在同一私有prefix。没有使用全局kill／stop或修改其他Nginx服务。


2026-10-29 M22后：8787的静态root仍为主目录frontend/dist，`/api` upstream已由8788切到127.0.0.1:8792 Java，master模式reload生效；155项入口合同通过。以后生成本机配置应将`@UPSTREAM@`替换为8792，不再指向停止的FastAPI。旧模板的8788说明仅作历史对照。
