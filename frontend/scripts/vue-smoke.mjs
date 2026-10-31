// 静态入口冒烟：公开页必须有服务端meta与预渲染正文；私有页为noindex SPA壳；未知路径HTTP404。
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../',import.meta.url));
const assets = await readdir(new URL('../dist/assets/',import.meta.url));
const sdk = assets.find(name=>name.startsWith('sdk-') && name.endsWith('.js'));
assert.ok(sdk, 'Missing SDK build entry');
const sdkEntry = await readFile(new URL(`../dist/assets/${sdk}`,import.meta.url),'utf8');
const sdkDependency = sdkEntry.match(/["']\.\/([^"']+\.js)["']/)?.[1];
assert.ok(sdkDependency && assets.includes(sdkDependency), 'Missing SDK implementation chunk');
assert.ok((await stat(new URL(`../dist/assets/${sdkDependency}`,import.meta.url))).size > 1000, 'SDK was removed by tree shaking');
const allJs = (await Promise.all(assets.filter(name=>name.endsWith('.js')).map(name=>readFile(new URL(`../dist/assets/${name}`,import.meta.url),'utf8')))).join('\n');
assert.ok(!allJs.includes('SYNTHETIC_VITE_SECRET_CANARY'), 'Server-only secret entered bundle');

const shell = await readFile(new URL('../dist/app.html',import.meta.url),'utf8');
assert.ok(shell.includes('<meta name="robots" content="noindex, nofollow">'), 'SPA shell must be noindex');
assert.ok(!/<main[\s>]/.test(shell), 'SPA shell must not carry prerendered body');

const publicPages = [
  { path:'/wardrobe', title:'衣装灵感 · 映想', marker:'下一套，', description:'浏览四季衣装参考图，按颜色、服装与细节多标签筛选，选择喜欢的衣装带入创作空间实时换装。' },
  { path:'/', title:'映想 — 让想象，在眼前发生。', marker:'让想象，', description:'映想提供实时换装、视频换装与提示词实时编辑。可使用摄像头、已有视频或提示词完成画面创作，生成内容自动保存。' },
  { path:'/pricing', title:'价格方案 · 映想', marker:'充值与积分', description:'轻享、创作与进阶三档积分方案，涵盖实时换装、视频换装与实时编辑。积分长期有效，支持沙盒测试购买；测试积分与真实生成权限独立，正式购买暂未开放。' },
  { path:'/help', title:'帮助中心 · 映想', marker:'使用指南与常见问题', description:'查看实时换装、视频换装与实时编辑的操作步骤、素材要求、积分说明和常见问题。' },
  { path:'/help/feedback', title:'问题反馈 · 映想', marker:'整理问题反馈', description:'整理问题或建议并在本机生成反馈报告，复制或下载后交给项目维护者；页面不联网提交。' },
  { path:'/privacy', title:'隐私与使用说明 · 映想', marker:'说明画面传输、云端处理、保存与删除规则。', description:'说明相机预览、云端处理、作品保存、截图与下载规则。' },
  { path:'/terms', title:'用户协议 · 映想', marker:'本协议说明账号、素材、生成、支付与作品保存规则。', description:'映想用户协议：账号、素材、生成、支付与作品保存规则。' },
];
const privateRoutes = ['/account','/account/usage','/account/orders','/account/security','/admin','/studio','/studio/video','/studio/edit','/works'];
const hashRoutes = ['/#creation-scenes','/terms#scope','/privacy#records','/studio#preview'];
const anchor = (html,name) => html.match(new RegExp(`<meta ${name}[^>]*content="([^"]*)"`))?.[1];

const reservation=createServer().listen(0,'127.0.0.1'); await once(reservation,'listening');
const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
try {
  const end=Date.now()+30_000;
  while (true) {
    try { if ((await fetch(`http://127.0.0.1:${port}/terms`,{signal:AbortSignal.timeout(1000)})).status===200) break; } catch {}
    assert.equal(child.exitCode,null,'Preview process exited'); assert.ok(Date.now()<end,'Preview start timed out');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  let assetsChecked=0;
  for (const page of publicPages) {
    const response=await fetch(`http://127.0.0.1:${port}${page.path}`); const html=await response.text();
    assert.equal(response.status,200,`${page.path} status`);
    assert.ok(response.headers.get('content-type')?.includes('text/html'),`${page.path} content type`);
    assert.equal(html.match(/<title>([\s\S]*?)<\/title>/)?.[1],page.title,`${page.path} title`);
    assert.equal(anchor(html,'name="description"'),page.description,`${page.path} description`);
    assert.equal(anchor(html,'property="og:title"'),page.title,`${page.path} og:title`);
    assert.equal(anchor(html,'property="og:description"'),page.description,`${page.path} og:description`);
    assert.equal(anchor(html,'name="twitter:card"'),'summary',`${page.path} twitter card`);
    assert.equal(anchor(html,'name="robots"'),'index, follow',`${page.path} robots`);
    assert.ok(/<html[^>]*\slang="zh-CN"/.test(html),`${page.path} lang`);
    assert.ok(html.includes(page.marker),`${page.path} prerendered body`);
    assert.ok(html.includes('<div id="app"'),`${page.path} app container`);
    assert.ok(!html.includes('账号读取中'),`${page.path} transient account state`);
    assert.ok(html.includes('type="module"'),`${page.path} module entry`);
    for (const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css|webp|jpg|svg))"/g)) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${asset}`)).status,200,`${page.path} asset ${asset}`); assetsChecked++;
    }
  }
  const home=await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const pricing=await (await fetch(`http://127.0.0.1:${port}/pricing`)).text();
  assert.notEqual(home,pricing,'Public routes must not share one prerendered document');
  for (const path of privateRoutes) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`); const html=await response.text();
    assert.equal(response.status,200,`${path} status`);
    assert.equal(html,shell,`${path} must serve the SPA shell`);
    assert.ok(!/<main[\s>]/.test(html),`${path} must not prerender private content`);
  }
  for (const path of hashRoutes) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status,200,`${path} status`); await response.text();
  }
  const unknown=await fetch(`http://127.0.0.1:${port}/not-a-real-page`); const unknownHtml=await unknown.text();
  assert.equal(unknown.status,404,'Unknown page keeps HTTP404');
  assert.equal(unknownHtml,shell,'Unknown page serves the SPA shell');
  console.log(JSON.stringify({status:'OK',staticRoutes:publicPages.length+privateRoutes.length+hashRoutes.length+1,prerendered:publicPages.length,privateSpa:privateRoutes.length,assetsChecked,sdkBundleNonEmpty:true,previewOnly:true}));
} finally {
  if (child.exitCode===null) { child.kill(); await once(child,'exit'); }
}
