import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const fetchLocal = (path, method = 'GET') => fetch(new URL(path, base), {
  method,
  ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
  signal: AbortSignal.timeout(15_000),
});

const home = await fetchLocal('/');
assert.equal(home.status, 200);
const html = await home.text();
assert.ok(html.includes('映想') && html.includes('让想象，') && html.includes('在眼前发生。'));
assert.ok(html.includes('实时换装') && html.includes('免费体验一次') && !html.includes('AI换装尚未接入'));
assert.equal(home.headers.get('x-powered-by'), null);
assert.doesNotMatch(html, /仅模拟流程|本地预览|预览体验状态/);
console.log('PASS 宣传首页、品牌与免费体验跳转');

const pages = { '/': html };
for (const route of ['/pricing', '/studio', '/account']) {
  const response = await fetchLocal(route); assert.equal(response.status, 200);
  pages[route] = await response.text();
  assert.equal(response.headers.get('location'), null);
}
assert.ok(pages['/pricing'].includes('拟定价格') && pages['/pricing'].includes('购买暂未开放') && pages['/pricing'].includes('56.90'));
assert.ok(pages['/studio'].includes('打开相机') && pages['/studio'].includes('映想画面') && pages['/studio'].includes('上衣参考图'));
assert.ok(html.includes('href="/studio"') && html.includes('href="/pricing"'));
const assets = new Set(Object.values(pages).flatMap((markup) => [...markup.matchAll(/(?:src|href)="(\/(?:_next\/static\/|assets\/)[^"]+)"/g)].map((match) => match[1])));
assert.ok(assets.size > 0);
for (const asset of assets) assert.equal((await fetchLocal(asset)).status, 200, asset);
console.log(`PASS 价格、创作、个人中心公开可访问及${assets.size}个生产资源`);

for (const route of ['config', 'health']) {
  const response = await fetchLocal(`/api/v1/${route}`), value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(value.mode, 'real'); assert.doesNotMatch(JSON.stringify(value), /apiKey|DECART_API_KEY/);
  if (route === 'config') { assert.equal(typeof value.features.realtime, 'boolean'); assert.equal(value.features.camera, true); assert.equal(value.maxDurationSec, 60); assert.equal(value.defaultDurationSec, 15); assert.deepEqual(value.durationOptions, [15, 30, 60]); }
  else { assert.equal(value.providerReady, false); assert.equal(value.storageReady, false); }
  console.log(`PASS GET /api/v1/${route}`);
}

for (const route of ['access/redeem', 'sessions', 'sessions/test/token', 'sessions/test/heartbeat', 'sessions/test/end']) {
  const response = await fetchLocal(`/api/v1/${route}`, 'POST'), value = await response.json();
  assert.equal(response.status, 503); assert.equal(value.error.code, 'SERVICE_DISABLED'); assert.equal(value.error.retryable, false);
  assert.ok(value.requestId); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(value.apiKey, undefined); assert.equal(value.sessionId, undefined);
  console.log(`PASS POST /api/v1/${route} → 503 SERVICE_DISABLED`);
}
assert.equal((await fetchLocal('/api/v1/sessions/test/token')).status, 405);
for (const path of ['/.env.example', '/.git/config', '/.cache/accounts/store.json', '/.cache/accounts/store.lock', '/src/lib/server/http.ts', '/frontend/.env.example', '/frontend/src/lib/server/http.ts']) assert.equal((await fetchLocal(path)).status, 404);
console.log('PASS 方法限制及非公开源码路径');

for (const [path, method] of [['/poc', 'GET'], ['/api/poc/status', 'GET'], ['/api/poc/token', 'POST'], ['/api/poc/observation', 'POST']]) assert.equal((await fetchLocal(path, method)).status, 404, path);
assert.equal((await fetchLocal('/api/studio/token', 'POST')).status, 403);
console.log('PASS 旧验证入口已移除、无来源的签发请求被拒绝');

const account = await fetchLocal('/api/account/me');
assert.equal(account.status, 200); assert.equal((await account.json()).user, null);
const unsigned = await fetch(new URL('/api/studio/token', base), { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}'});
assert.equal(unsigned.status, 401);
console.log('PASS 未登录账号状态和模型签发鉴权');
