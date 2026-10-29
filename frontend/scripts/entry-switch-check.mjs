// 正式入口只读合同检查：对已切换的Nginx静态入口做无JavaScript的HTTP核对。
// 只发GET／HEAD／OPTIONS，不写数据库、不登录、不调用模型或支付。
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const originArg = process.argv.find(value => value.startsWith('--origin='));
const origin = new URL(originArg?.slice('--origin='.length) ?? 'http://127.0.0.1:8787');
assert.equal(origin.protocol, 'http:', '入口必须是本机HTTP');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname), '入口必须是回环地址');
const port = Number(origin.port || 80);
const host = `${origin.hostname}:${port}`;
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

function http(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: origin.hostname, port, path, method, headers: { Host: host, ...headers }, timeout: 15000 }, response => {
      const chunks = [];
      response.on('data', part => chunks.push(part));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`入口请求超时：${path}`)));
    req.end();
  });
}

const text = value => value.body.toString('utf8');
const meta = (html, name) => html.match(new RegExp(`<meta ${name}[^>]*content="([^"]*)"`))?.[1];
const publicPages = [
  ['/', 'index.html', '映想 — 让想象，在眼前发生。', '让想象，'],
  ['/pricing', 'pricing/index.html', '价格方案 · 映想', '选择适合你的创作套餐'],
  ['/help', 'help/index.html', '帮助中心 · 映想', '使用指南与常见问题'],
  ['/help/feedback', 'help/feedback/index.html', '问题反馈 · 映想', '整理问题反馈'],
  ['/privacy', 'privacy/index.html', '隐私与使用说明 · 映想', '隐私与使用说明'],
  ['/terms', 'terms/index.html', '用户协议 · 映想', '用户协议'],
];
const privateRoutes = ['/account', '/account/usage', '/account/orders', '/account/security', '/admin', '/studio', '/studio/video', '/studio/edit', '/works'];

try {
  const shell = await readFile(join(dist, 'app.html'));

  // 公开页：直接返回各自预渲染HTML，服务端meta与正文齐全。
  for (const [path, file, title, marker] of publicPages) {
    const expected = await readFile(join(dist, file));
    const value = await http(path);
    const html = text(value);
    check(value.status === 200 && value.body.equals(expected), `${path} 必须是自己的预渲染HTML`);
    check(value.headers['content-type']?.startsWith('text/html'), `${path} content-type`);
    check(value.headers['cache-control'] === 'no-store', `${path} HTML不缓存`);
    check(!value.headers['x-robots-tag'], `${path} 公开页不带noindex头`);
    check(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] === title, `${path} 服务端title`);
    check(/<html[^>]*\slang="zh-CN"/.test(html), `${path} 服务端lang`);
    check(meta(html, 'name="description"'), `${path} description`);
    check(meta(html, 'property="og:title"') === title, `${path} og:title`);
    check(meta(html, 'property="og:description"'), `${path} og:description`);
    check(meta(html, 'name="twitter:card"') === 'summary', `${path} twitter卡片`);
    check(meta(html, 'name="robots"') === 'index, follow', `${path} 可索引`);
    check(html.includes(marker), `${path} 预渲染正文`);
    check(!html.includes('账号读取中'), `${path} 无异步占位`);
  }
  const queryPage = await http('/terms?synthetic=1');
  check(queryPage.status === 200 && queryPage.body.equals(await readFile(join(dist, 'terms/index.html'))), '带查询参数的公开页仍返回预渲染HTML');

  // 私有页与404：统一noindex SPA壳，不预渲染私有内容。
  for (const path of privateRoutes) {
    const value = await http(path);
    check(value.status === 200 && value.body.equals(shell), `${path} 返回SPA壳`);
    check(value.headers['x-robots-tag'] === 'noindex, nofollow', `${path} noindex头`);
    check(!/<main[\s>]/.test(text(value)), `${path} 不预渲染私有正文`);
  }
  for (const path of ['/account/', '/studio/edit/']) {
    const value = await http(path);
    check(value.status === 200 && value.body.equals(shell), `${path} 尾斜杠仍返回SPA壳`);
    check(value.headers['x-robots-tag'] === 'noindex, nofollow', `${path} 尾斜杠noindex`);
  }
  const unknown = await http('/synthetic-not-a-page');
  check(unknown.status === 404 && unknown.body.equals(shell), '未知页面保留HTTP404与SPA壳');
  check(unknown.headers['x-robots-tag'] === 'noindex, nofollow', '未知页面noindex');
  const shellDirect = await http('/app.html');
  check(shellDirect.status === 200 && shellDirect.body.equals(shell) && shellDirect.headers['x-robots-tag'] === 'noindex, nofollow', '壳文件可直接访问且noindex');
  check((await http('/index.html')).status === 200, '预渲染首页文件可访问');

  // 静态资源：指纹缓存、304、缺失资源不回退HTML。
  const html = text(await http('/'));
  const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  const style = html.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  check(script && style, '入口引用构建资源');
  for (const asset of [script, style]) {
    const value = await http(asset);
    check(value.status === 200 && value.headers['cache-control']?.includes('immutable'), `${asset} 指纹缓存`);
    const conditional = await http(asset, { headers: { 'If-None-Match': value.headers.etag } });
    check(conditional.status === 304 && conditional.body.length === 0, `${asset} 条件请求304`);
  }
  check((await http(script)).headers['content-type']?.includes('javascript'), '脚本MIME');
  check((await http(style)).headers['content-type']?.includes('css'), '样式MIME');
  const missing = await http('/assets/synthetic-missing-12345678.js');
  check(missing.status === 404 && !missing.body.equals(shell) && missing.headers['cache-control'] === 'no-store', '缺失资源404且不回退HTML');
  check((await http('/assets/.synthetic-hidden')).status === 404, '隐藏资源路径404');
  check((await http('/.git/config')).status === 404, '隐藏目录404');

  // 静态Range与HEAD（正式媒体走API，API Range由smoke:nginx的同一Nginx合同覆盖）。
  const media = '/assets/try-on-demo.mp4';
  const total = Number((await http(media)).headers['content-length']);
  const range = await http(media, { headers: { Range: 'bytes=0-99' } });
  check(range.status === 206 && range.headers['content-range'] === `bytes 0-99/${total}` && range.body.length === 100, 'Range返回206与准确区间');
  const rangeHead = await http(media, { method: 'HEAD', headers: { Range: 'bytes=0-99' } });
  check(rangeHead.status === 206 && rangeHead.body.length === 0 && rangeHead.headers['content-length'] === '100', 'HEAD Range无正文');
  check((await http(media, { headers: { Range: 'bytes=999999-1000000' } })).status === 416, '越界Range返回416');
  check((await http(media, { headers: { Range: 'bytes=0-99', 'If-Range': '"different-etag"' } })).status === 200, 'If-Range不符回退200');
  const pageHead = await http('/pricing', { method: 'HEAD' });
  check(pageHead.status === 200 && pageHead.body.length === 0 && pageHead.headers['content-length'], 'HEAD公开页无正文');

  // API匿名边界：只读GET／HEAD，不登录、不写库。
  const me = await http('/api/account/me');
  check(me.status === 200 && JSON.parse(text(me)).data.user === null, '匿名本人视图为空');
  check(me.headers['cache-control'] === 'no-store', '本人接口不缓存');
  check(me.headers['x-content-type-options'] === 'nosniff', '私有响应nosniff');
  const cookieMe = await http('/api/account/me', { headers: { Cookie: 'yingxiang_session=synthetic-invalid' } });
  check(cookieMe.status === 200 && JSON.parse(text(cookieMe)).data.user === null, '无效Cookie仍按匿名处理');
  const goodOrigin = await http('/api/account/me', { headers: { Origin: origin.origin } });
  check(goodOrigin.status === 200, '同源Origin可读');
  const badOrigin = await http('/api/account/me', { headers: { Origin: 'http://forged.invalid' } });
  check(badOrigin.status === 403 && JSON.parse(text(badOrigin)).reason === 'ORIGIN_REJECTED', '伪造Origin被拒');
  for (const path of ['/api/works', '/api/payments/orders', '/api/admin/overview', '/api/video/history']) {
    const value = await http(path);
    check(value.status === 401, `${path} 匿名401`);
    check(value.headers['cache-control'] === 'no-store', `${path} 不缓存`);
  }
  const videoJobs = await http('/api/video/jobs');
  check(videoJobs.status === 200 ? JSON.parse(text(videoJobs)).data.available === false : videoJobs.status === 401, '匿名视频任务不泄露数据');
  const announcement = await http('/api/site/announcement');
  check(announcement.status === 200 && typeof JSON.parse(text(announcement)).data.enabled === 'boolean', '公告公开读取');
  const payments = await http('/api/payments/status');
  const paymentStatus = JSON.parse(text(payments)).data;
  check(payments.status === 200 && typeof paymentStatus.testEnabled === 'boolean' && paymentStatus.liveEnabled === false, '正式购买关闭（liveEnabled=false）');
  const announcementHead = await http('/api/site/announcement', { method: 'HEAD' });
  check(announcementHead.status === 200 && announcementHead.body.length === 0, 'API HEAD无正文');
  const wrongMethod = await http('/api/account/me', { method: 'PUT' });
  check(wrongMethod.status === 405 && JSON.parse(text(wrongMethod)).reason === 'METHOD_NOT_ALLOWED', '不支持的方法405');
  const options = await http('/api/account/me', { method: 'OPTIONS' });
  check(options.status === 204 && String(options.headers.allow).includes('GET'), 'OPTIONS返回允许方法');
  const getOnPost = await http('/api/account/login');
  check(getOnPost.status === 404 && JSON.parse(text(getOnPost)).reason === 'NOT_FOUND', 'POST接口不接受GET且不泄露');
  const unknownApi = await http('/api/synthetic-not-found');
  check(unknownApi.status === 404 && JSON.parse(text(unknownApi)).reason === 'NOT_FOUND', '未知API保留上游404 JSON');
  check(!unknownApi.body.equals(shell), '未知API不落入SPA');
  const forgedHost = await http('/pricing', { headers: { Host: 'forged.invalid' } });
  check(forgedHost.status === 403, '伪造Host被入口拒绝');
  const localhostHost = await http('/pricing', { headers: { Host: `localhost:${port}` } });
  check(localhostHost.status === 200, 'localhost同端口可用');
  check(!String((await http('/')).headers.server ?? '').match(/nginx\/[\d.]+/), '不暴露Nginx版本');

  console.log(JSON.stringify({
    status: 'OK',
    origin: origin.origin,
    checks,
    publicPages: publicPages.length,
    privateRoutes: privateRoutes.length,
    apiReadsOnly: true,
    realProviderCalls: 0,
    payments: 0,
    writes: 0,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
