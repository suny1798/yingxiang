import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PocGate, PocError } from '../src/lib/server/poc-gate';
import { POC_POLICY } from '../src/lib/poc/policy';

const origin = 'http://127.0.0.1:8787';
const env = { YINGXIANG_POC_ENABLED: 'true', DECART_API_KEY: 'unit-test-permanent-secret' };
const request = (access?: string, changes: Record<string, unknown> = {}, headers: Record<string, string> = {}) => new Request(`${origin}/api/poc/token`, { method: 'POST', headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json', 'x-poc-access': access ?? '', ...headers }, body: JSON.stringify({ attemptId: randomUUID(), consentVersion: POC_POLICY.consentVersion, ...changes }) });
const statusRequest = () => new Request(`${origin}/api/poc/status`, { headers: { host: '127.0.0.1:8787' } });
async function setup(options: { env?: Record<string, string | undefined>; invalidToken?: boolean; failure?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-poc-test-'));
  const sent: Array<{ url: string; body: Record<string, unknown>; key: string | null }> = [];
  const upstream = (async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body as string), key: new Headers(init?.headers).get('X-API-KEY') });
    if (options.failure) throw new Error('private upstream diagnostic with credential');
    return Response.json({ apiKey: 'ek_unit_test_ephemeral', expiresAt: new Date(Date.now() + 9000).toISOString(),
      permissions: { models: [POC_POLICY.model], origins: [origin] }, constraints: { realtime: { maxSessionDuration: options.invalidToken ? 3600 : 15 } } });
  }) as typeof fetch;
  return { dir, sent, gate: new PocGate(dir, options.env ?? env, upstream) };
}

test('无密钥或开关关闭只报告不可用，不调用供应商或暴露环境', async () => {
  for (const configuration of [{}, { YINGXIANG_POC_ENABLED: 'true' }, { DECART_API_KEY: env.DECART_API_KEY }]) {
    const s = await setup({ env: configuration }), status = await s.gate.status(statusRequest());
    assert.equal(status.available, false); assert.equal(status.access, undefined); assert.equal(s.sent.length, 0);
    await assert.rejects(s.gate.issue(request()), (error: PocError) => error.code === 'SERVICE_DISABLED');
    assert.doesNotMatch(JSON.stringify(status), /unit-test-permanent/);
  }
});

test('来源、Host、访问凭据、额外模型字段和过期告知均在上游调用前拒绝', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  for (const req of [request(status.access, {}, { origin: 'https://evil.example' }), request(status.access, {}, { host: 'evil.example' }), request('0'.repeat(64)), request('é'.repeat(64)), request(status.access, { model: 'lucy-2.5' }), request(status.access, { consentVersion: 'old' })]) {
    await assert.rejects(s.gate.issue(req), PocError);
  }
  assert.equal(s.sent.length, 0);
});

test('并行与重启只签发一次；持久记录不含长期密钥或短期令牌', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  const results = await Promise.allSettled([s.gate.issue(request(status.access)), s.gate.issue(request(status.access))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].key, env.DECART_API_KEY);
  assert.deepEqual(s.sent[0].body, { expiresIn: 10, allowedModels: [POC_POLICY.model], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: 15 } } });
  const reloaded = new PocGate(s.dir, env, (async () => { throw new Error('MUST NOT CALL'); }) as typeof fetch);
  assert.equal((await reloaded.status(statusRequest())).available, false);
  await assert.rejects(reloaded.issue(request(status.access)), (error: PocError) => error.code === 'ATTEMPT_SPENT');
  const ledger = await readFile(path.join(s.dir, `${POC_POLICY.batchId}.json`), 'utf8');
  assert.doesNotMatch(ledger, /unit-test-permanent-secret|ek_unit_test_ephemeral/); assert.equal(JSON.parse(ledger).state, 'issued');
});

test('上游失败或返回不受限令牌时拒绝释放测试名额，不回传原始诊断', async () => {
  for (const options of [{ failure: true }, { invalidToken: true }]) {
    const s = await setup(options), status = await s.gate.status(statusRequest());
    await assert.rejects(s.gate.issue(request(status.access)), (error: PocError) => error.code === 'TOKEN_RESULT_UNKNOWN' && !error.message.includes('credential'));
    assert.equal((await s.gate.status(statusRequest())).state, 'unknown');
    await assert.rejects(s.gate.issue(request(status.access))); assert.equal(s.sent.length, 1);
  }
});

test('超限JSON请求在签发前拒绝', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest());
  await assert.rejects(s.gate.issue(request(status.access, { extra: 'x'.repeat(5000) })), (error: PocError) => error.status === 413);
  assert.equal(s.sent.length, 0);
});

test('客户端观测不作为账单，重复记录保持第一次数据', async () => {
  const s = await setup(), status = await s.gate.status(statusRequest()), attemptId = randomUUID();
  await s.gate.issue(request(status.access, { attemptId }));
  const observationRequest = (firstFrameMs: number) => new Request(`${origin}/api/poc/observation`, { method: 'POST', headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json', 'x-poc-access': status.access! }, body: JSON.stringify({ attemptId, outcome: 'ended', firstFrameMs, providerReportedSeconds: 8, localTracksEnded: true }) });
  await Promise.all([s.gate.observe(observationRequest(1500)), s.gate.observe(observationRequest(2500))]);
  const ledger = JSON.parse(await readFile(path.join(s.dir, `${POC_POLICY.batchId}.json`), 'utf8'));
  assert.equal(ledger.state, 'finished'); assert.ok([1500,2500].includes(ledger.observation.firstFrameMs)); assert.equal(ledger.actualCostUsd, undefined);
  assert.equal((await readdir(s.dir)).length, 3);
});
