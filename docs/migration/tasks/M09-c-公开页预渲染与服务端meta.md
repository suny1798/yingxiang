# M09-c：公开页预渲染与服务端meta

关联M09、FR34—42／NFR09、T51-C02／11，按[16附录A.2](../../16-前后端技术与架构迁移执行方案.md#a2-react到vue的映射)与7.3节实施；状态只维护在05。沿用当前worktree与`frontend/`，不切正式入口、不改正式Nginx、不停止8787 Next。

## 背景与目标

M09-b结束时公开页仍只有SPA壳：直接HTTP请求、无JavaScript时只有空`#app`，客户端`document.title`不等价于服务端meta；16附录A.2要求“若公开页内容退化，先补预渲染再关闭该项”。本片补齐入口切换前的最后一项内容门槛。

- `/`、`/pricing`、`/help`、`/help/feedback`、`/privacy`、`/terms` 在构建期生成各自的静态HTML，直接请求即返回该路由的`<title>`、`<meta name="description">`、Open Graph／Twitter标签、`<html lang>`与可抓取正文。
- `/account`、`/account/*`、`/admin`、`/studio`、`/studio/*`、`/works` 继续SPA，返回`noindex`壳，不预渲染任何私有内容。
- 未知路径保留HTTP404并返回同一`noindex`壳。
- 保持既有视觉、文案、语言／主题偏好、URL与路由；中文为默认服务端meta，英文仍由客户端偏好切换。

## 方案

构建期静态预渲染，不新增常驻Node SSR服务，Nginx仍是静态文件＋`/api`代理。

1. `vite build`照常产出入口壳`dist/index.html`。
2. `scripts/prerender.ts`（`tsx`执行）把壳复制为`dist/app.html`并注入`noindex`；启动仅回环的临时静态服务，对三个只读接口返回匿名替身（`/api/account/me`、`/api/site/announcement`、`/api/payments/status`），保证抓取到的是“无Cookie匿名访客”状态，不读取真实账号、公告或支付。
3. 用本机Chromium无头浏览器`--dump-dom --virtual-time-budget=3000`逐路由抓取已构建页面，得到与客户端一致的DOM。
4. 校验标题、`lang="zh-CN"`、`#app`、`<main>`、每页关键正文与匿名头部；任何一项缺失即中止构建，不生成空壳。
5. 移除抓取时客户端写入的动态标签，统一注入description、robots、OG／Twitter；写出`dist/index.html`与`dist/<path>/index.html`，并生成`dist/entry-routes.json`供preview与工具共用。
6. 客户端继续用`createApp`挂载（不清空再重建的差异由同构DOM覆盖），路由变化时由`document-meta.ts`同步标题、描述、robots与分享标签。

## 依赖与可回退性

- 不新增npm依赖：预渲染用本机Chromium可执行文件（可用`YINGXIANG_CHROME_BIN`指定，找不到时构建失败并提示），脚本用已锁定的`tsx 4.23.15`运行。
- `YINGXIANG_PUBLIC_ORIGIN`未设置时省略`canonical`、`og:url`与分享图绝对地址，不使用虚构域名。
- 回退：`npm run build`改回`vite build`并恢复`try_files $uri /index.html`即可回到纯SPA入口；预渲染产物全部在`dist/`内，不写数据库、不读密钥。

## 验收

- 无JavaScript的HTTP请求逐页核对`title`／`description`／OG／Twitter／`lang`／正文关键文案；私有页200＋`noindex`＋空壳；未知路径404。
- 1440×1000桌面：禁用JavaScript时六页正文可见、无横向溢出；开启JavaScript后无重复`header`／`main`、无页面异常，语言／主题在刷新后保持，SPA路由与404正常。
- `npm run check`、`npm run legacy:typecheck`、`npm run smoke`、`npm run smoke:nginx`通过；既有桌面脚本回归。
- 不写入正式库、不调用真实模型／Stripe、不读长期密钥；不切正式入口。

## 边界

- 静态文件服务器（preview与Nginx模板）负责按路径返回预渲染HTML；正式入口切换、正式Nginx与CDN缓存策略不在本片。
- 预渲染只在构建机执行，构建机需要Chromium内核浏览器；未接入持续集成。
- 英文页面仍是同一URL的客户端切换，不生成英文静态页；抓取器只看到中文默认meta。
- 不覆盖手机端、跨浏览器或真实搜索引擎收录结果。
