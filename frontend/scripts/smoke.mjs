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
assert.ok(html.includes('本地 Mock'));
assert.equal(home.headers.get('x-powered-by'), null);
console.log('PASS 主页、品牌与Mock标识');

const assets = new Set([...html.matchAll(/(?:src|href)="(\/(?:_next\/static\/|assets\/)[^"]+)"/g)].map((match) => match[1]));
assert.ok(assets.size > 0);
for (const asset of assets) assert.equal((await fetchLocal(asset)).status, 200, asset);
console.log(`PASS ${assets.size}个生产静态资源`);

for (const route of ['config', 'health']) {
  const response = await fetchLocal(`/api/v1/${route}`), value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(value.mode, 'mock'); assert.doesNotMatch(JSON.stringify(value), /apiKey|DECART_API_KEY/);
  if (route === 'config') { assert.equal(value.features.realtime, false); assert.equal(value.features.camera, true); }
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
for (const path of ['/.env.example', '/.git/config', '/src/lib/server/http.ts', '/frontend/.env.example', '/frontend/src/lib/server/http.ts']) assert.equal((await fetchLocal(path)).status, 404);
console.log('PASS 方法限制及非公开源码路径');
