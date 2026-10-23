import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioGate, StudioError } from '../src/lib/server/studio-gate';
import { STUDIO_POLICY } from '../src/lib/studio/policy';

const origin = 'http://127.0.0.1:8787';
const env = { YINGXIANG_STUDIO_ENABLED: 'true', DECART_API_KEY: 'unit-test-permanent-secret' };
const request = (access?: string, changes: Record<string, unknown> = {}, headers: Record<string, string> = {}) => new Request(`${origin}/api/studio/token`, { method: 'POST', headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json', 'x-studio-access': access ?? '', ...headers }, body: JSON.stringify({ attemptId: randomUUID(), consentVersion: STUDIO_POLICY.consentVersion, ...changes }) });
const statusRequest = () => new Request(`${origin}/api/studio/status`, { headers: { host: '127.0.0.1:8787' } });
async function setup(options: { env?: Record<string, string | undefined>; invalidToken?: boolean; failure?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-studio-test-'));
  const sent: Array<{ url: string; body: Record<string, unknown>; key: string | null }> = [];
  const upstream = (async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body as string), key: new Headers(init?.headers).get('X-API-KEY') });
    if (options.failure) throw new Error('private upstream diagnostic with credential');
    const duration = (sent.at(-1)!.body.constraints as { realtime: { maxSessionDuration: number } }).realtime.maxSessionDuration;
    return Response.json({ apiKey: 'ek_unit_test_ephemeral', expiresAt: new Date(Date.now() + 9000).toISOString(),
      permissions: { models: [STUDIO_POLICY.model], origins: [origin] }, constraints: { realtime: { maxSessionDuration: options.invalidToken ? 3600 : duration } } });
  }) as typeof fetch;
  return { dir, sent, upstream, gate: new StudioGate(dir, options.env ?? env, upstream) };
}

test('无密钥或开关关闭不调用供应商、不暴露环境', async () => {
  for (const configuration of [{}, { YINGXIANG_STUDIO_ENABLED: 'true' }, { DECART_API_KEY: env.DECART_API_KEY }]) {
    const s = await setup({ env: configuration }), status = await s.gate.status(statusRequest());
    assert.equal(status.available, false); assert.equal(status.access, undefined); assert.equal(s.sent.length, 0);
    await assert.rejects(s.gate.issue(request()), (error: StudioError) => error.code === 'SERVICE_DISABLED');
    assert.doesNotMatch(JSON.stringify(status), /unit-test-permanent/);
  }
});

test('来源、Host、访问凭据、旧告知、额外字段和非法操作号都在上游调用前拒绝', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  for (const req of [request(status.access, {}, { origin: 'https://evil.example' }), request(status.access, {}, { host: 'evil.example' }), request('0'.repeat(64)), request('é'.repeat(64)), request(status.access, { model: 'lucy-2.5' }), request(status.access, { consentVersion: 'old' }), request(status.access, { attemptId: '../other' })]) await assert.rejects(s.gate.issue(req), StudioError);
  assert.equal(s.sent.length, 0);
});

test('新操作可重复签发，同一操作并行和重启后重放均拒绝，限制严格且记录无密钥', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest()), first = randomUUID(), second = randomUUID();
  const req = (id: string) => request(status.access, { attemptId: id });
  const results = await Promise.allSettled([s.gate.issue(req(first)), s.gate.issue(req(first))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await s.gate.issue(req(second)); assert.equal(s.sent.length, 2);
  assert.deepEqual(s.sent[0].body, { expiresIn: 10, allowedModels: [STUDIO_POLICY.model], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: 15 } } });
  assert.equal(s.sent[0].key, env.DECART_API_KEY);
  const reloaded = new StudioGate(s.dir, env, s.upstream);
  await assert.rejects(reloaded.issue(req(first)), (error: StudioError) => error.code === 'ATTEMPT_SPENT');
  assert.equal(s.sent.length, 2); assert.equal((await reloaded.status(statusRequest())).available, true);
  for (const id of [first,second]) assert.doesNotMatch(await readFile(path.join(s.dir, `${id}.json`), 'utf8'), /unit-test-permanent-secret|ek_unit_test_ephemeral/);
});

test('上游失败或不受限令牌保留未知记录，不回传原始诊断，也不重放同一申请', async () => {
  for (const options of [{ failure: true }, { invalidToken: true }]) {
    const s = await setup(options), status = await s.gate.status(statusRequest()), attemptId = randomUUID();
    await assert.rejects(s.gate.issue(request(status.access, { attemptId })), (error: StudioError) => error.code === 'TOKEN_RESULT_UNKNOWN' && !error.message.includes('credential'));
    const ledger = JSON.parse(await readFile(path.join(s.dir, `${attemptId}.json`), 'utf8')); assert.equal(ledger.state, 'unknown');
    await assert.rejects(s.gate.issue(request(status.access, { attemptId }))); assert.equal(s.sent.length, 1);
  }
});

test('超限JSON在签发前拒绝', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  await assert.rejects(s.gate.issue(request(status.access, { extra: 'x'.repeat(5000) })), (error: StudioError) => error.status === 413);
  assert.equal(s.sent.length, 0);
});

test('客户端观测按操作保存，不作为账单，重复记录保持第一次数据', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest()), attemptId = randomUUID();
  await s.gate.issue(request(status.access, { attemptId }));
  const observation = (firstFrameMs: number) => new Request(`${origin}/api/studio/observation`, { method: 'POST', headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json', 'x-studio-access': status.access! }, body: JSON.stringify({ attemptId, outcome: 'ended', firstFrameMs, providerReportedSeconds: 8, localTracksEnded: true }) });
  await Promise.all([s.gate.observe(observation(1500)), s.gate.observe(observation(2500))]);
  const ledger = JSON.parse(await readFile(path.join(s.dir, `${attemptId}.json`), 'utf8'));
  assert.equal(ledger.state, 'finished'); assert.ok([1500,2500].includes(ledger.observation.firstFrameMs)); assert.equal(ledger.actualCostUsd, undefined);
  assert.equal((await readdir(s.dir)).length, 3);
});


test('三档供应商约束及业务记录一致，TTL只保留10秒，长时需明确权益所有者', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  const claimed: number[] = [];
  const owner = { userId: 'unit-user', claim: async (_id: string, seconds: number) => { claimed.push(seconds); }, issued: async () => {} };
  for (const seconds of [15, 30, 60]) {
    const attemptId = randomUUID();
    const result = await s.gate.issue(request(status.access, { attemptId, durationSec: seconds }), owner);
    assert.equal(result.durationSec, seconds);
    assert.deepEqual(s.sent.at(-1)!.body.constraints, { realtime: { maxSessionDuration: seconds } });
    assert.equal(s.sent.at(-1)!.body.expiresIn, 10);
    const ledger = JSON.parse(await readFile(path.join(s.dir, `${attemptId}.json`), 'utf8'));
    assert.equal(ledger.connectionCapSec, seconds);
  }
  assert.deepEqual(claimed, [15, 30, 60]);
  await assert.rejects(s.gate.issue(request(status.access, { durationSec: 30 })), { code: 'LOGIN_REQUIRED' });
  assert.equal(s.sent.length, 3);
});

test('非法档位及额外字段在账户占位和上游之前拒绝，长时返回错误上限则失败关闭', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest()); let claims = 0;
  const owner = { userId: 'unit-user', claim: async () => { claims++; }, issued: async () => {} };
  for (const value of [0, 10, 15.5, 120, -15, '30', null, {}, [30]]) await assert.rejects(s.gate.issue(request(status.access, { durationSec: value }), owner), { code: 'INVALID_DURATION' });
  await assert.rejects(s.gate.issue(request(status.access, { durationSec: 60, maxSessionDuration: 60 }), owner), { code: 'INVALID_REQUEST' });
  assert.equal(claims, 0); assert.equal(s.sent.length, 0);
  const invalid = await setup({ invalidToken: true }), ready = await invalid.gate.status(statusRequest());
  for (const seconds of [30, 60]) await assert.rejects(invalid.gate.issue(request(ready.access, { durationSec: seconds }), owner), { code: 'TOKEN_RESULT_UNKNOWN' });
});
