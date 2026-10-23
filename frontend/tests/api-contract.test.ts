import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as config } from '../src/app/api/v1/config/route';
import { GET as health } from '../src/app/api/v1/health/route';
import { POST as createSession } from '../src/app/api/v1/sessions/route';
import { POST as token } from '../src/app/api/v1/sessions/[id]/token/route';
import { POST as redeem } from '../src/app/api/v1/access/redeem/route';
import { POST as heartbeat } from '../src/app/api/v1/sessions/[id]/heartbeat/route';
import { POST as end } from '../src/app/api/v1/sessions/[id]/end/route';

test('公开配置明确真实入口与时限，且不含凭据', async () => {
  const response = config(), value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(value.mode, 'real'); assert.equal(value.features.realtime, process.env.YINGXIANG_STUDIO_ENABLED === 'true' && !!process.env.DECART_API_KEY?.trim()); assert.equal(value.features.camera, true);
  assert.equal(value.maxDurationSec, 60); assert.equal(value.defaultDurationSec, 15); assert.deepEqual(value.durationOptions, [15, 30, 60]);
  assert.doesNotMatch(JSON.stringify(value), /apiKey|DECART_API_KEY|token/i);
});
test('健康检查区分应用健康和模型/存储尚未配置', async () => {
  const value = await health().json(); assert.equal(value.status, 'ok'); assert.equal(value.providerReady, false); assert.equal(value.storageReady, false);
});
for (const [name, handler] of [['sessions', createSession], ['token', token], ['redeem', redeem], ['heartbeat', heartbeat], ['end', end]] as const) {
  test(`${name} 未启用时明确拒绝，不返回假令牌或假身份`, async () => {
    const response = handler(), value = await response.json();
    assert.equal(response.status, 503); assert.equal(value.error.code, 'SERVICE_DISABLED'); assert.equal(value.error.retryable, false);
    assert.ok(value.requestId); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(value.apiKey, undefined); assert.equal(value.sessionId, undefined);
  });
}
