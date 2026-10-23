import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccountStore } from '../src/lib/server/account-store';
import { StudioGate } from '../src/lib/server/studio-gate';
import { STUDIO_POLICY } from '../src/lib/studio/policy';

const origin = 'http://127.0.0.1:8787';
const password = 'unit-test-password-2026';
const request = (cookie = '', body?: Record<string, unknown>, extra: Record<string, string> = {}) => new Request(`${origin}/api/account/login`, {
  method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:8787', origin, cookie, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}),
});
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-account-test-'));
  const store = new AccountStore(path.join(dir, 'accounts'));
  const signup = async (username = 'tester') => {
    const result = await store.authenticate(request('', { username, password }), true);
    return { ...result, request: request(result.cookie.split(';')[0]), cookie: result.cookie.split(';')[0] };
  };
  return { dir, store, signup };
}
test('注册、登录和重启保留一次权益，密码和会话原文不落盘', async () => {
  const s = await setup(), user = await s.signup('Tester');
  assert.equal(user.view.user?.username, 'tester'); assert.equal(user.view.trial, 'ready');
  assert.match(user.cookie, /yingxiang_session=/);
  const again = await s.store.authenticate(request('', { username: 'TESTER', password }), false);
  assert.equal(again.view.user?.id, user.view.user?.id);
  assert.match(again.cookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800/);
  assert.equal((await new AccountStore(path.join(s.dir, 'accounts')).me(user.request)).user?.id, user.view.user?.id);
  const saved = await readFile(path.join(s.dir, 'accounts/store.json'), 'utf8');
  assert.ok(!saved.includes(password)); assert.ok(!saved.includes(user.cookie.split('=')[1]));
  assert.equal(JSON.parse(saved).users.length, 1);
  assert.equal('passwordHash' in again.view.user!, false);
});
test('并行注册相同账号只创建一个用户，错误登录与无会话不能访问权益', async () => {
  const s = await setup();
  const registrations = await Promise.allSettled([s.signup(), s.signup('TESTER')]);
  assert.equal(registrations.filter((item) => item.status === 'fulfilled').length, 1);
  await assert.rejects(s.store.authenticate(request('', { username: 'tester', password: 'wrong-password' }), false), { code: 'INVALID_CREDENTIALS' });
  assert.equal((await s.store.me(request())).user, null);
  await assert.rejects(s.store.requireUser(request()), { code: 'LOGIN_REQUIRED' });
});
test('退出撤销会话且失效会话不能申请体验', async () => {
  const s = await setup(), user = await s.signup();
  assert.match(await s.store.logout(user.request), /Max-Age=0/);
  assert.equal((await s.store.me(user.request)).user, null);
  await assert.rejects(s.store.claim(user.request, user.view.user!.id, randomUUID()), { code: 'LOGIN_REQUIRED' });
  const other = await s.signup('other');
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data.sessions.forEach((item: { expiresAt: number }) => { item.expiresAt = 0; });
  await writeFile(file, JSON.stringify(data));
  assert.equal((await s.store.me(other.request)).user, null);
});
test('一个账号跨仓储实例并行申请也只有一次，重启或重新登录不恢复', async () => {
  const s = await setup(), user = await s.signup();
  const second = new AccountStore(path.join(s.dir, 'accounts'));
  const results = await Promise.allSettled([s.store.claim(user.request, user.view.user!.id, randomUUID()), second.claim(user.request, user.view.user!.id, randomUUID())]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const view = await second.me(user.request); assert.equal(view.trial, 'review'); assert.equal(view.history.length, 1);
  await s.store.issued(user.view.user!.id, view.history[0].id);
  await s.store.observe(user.view.user!.id, view.history[0].id, 'ended');
  const login = await s.store.authenticate(request('', { username: 'tester', password }), false);
  assert.equal(login.view.trial, 'used'); assert.equal(login.view.history[0].outcome, 'ended');
  await assert.rejects(s.store.requireTrial(user.request), { code: 'TRIAL_USED' });
});
test('恶意来源、额外字段和持续错误密码被拒绝，限流重启后仍有效', async () => {
  const s = await setup(); await s.signup();
  await assert.rejects(s.store.authenticate(request('', { username: 'tester', password }, { origin: 'https://bad.example' }), false), { code: 'ORIGIN_REJECTED' });
  await assert.rejects(s.store.authenticate(request('', { username: 'tester', password, trial: 'ready' }), false), { code: 'INVALID_ACCOUNT' });
  for (let count = 0; count < 9; count++) await assert.rejects(s.store.authenticate(request('', { username: 'tester', password: 'wrong-password' }), false), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(new AccountStore(path.join(s.dir, 'accounts')).authenticate(request('', { username: 'tester', password }), false), { code: 'RATE_LIMITED' });
});
test('损坏文件失败关闭，不能重建空账号库重新赠送', async () => {
  const s = await setup(); await s.signup();
  await writeFile(path.join(s.dir, 'accounts/store.json'), 'broken json');
  await assert.rejects(s.store.me(request()), { code: 'ACCOUNT_STORE_UNAVAILABLE' });
  assert.equal(await readFile(path.join(s.dir, 'accounts/store.json'), 'utf8'), 'broken json');
});
test('签发与权益衔接：无效告知不占用，并行不同UUID只调用一次上游，历史不串账号', async () => {
  const s = await setup(), user = await s.signup(), other = await s.signup('other'); let calls = 0;
  const gate = new StudioGate(path.join(s.dir, 'studio'), { YINGXIANG_STUDIO_ENABLED: 'true', DECART_API_KEY: 'unit-test-secret' }, (async () => {
    calls++;
    return Response.json({ apiKey: 'unit-test-ephemeral', expiresAt: new Date(Date.now() + 9000).toISOString(), permissions: { models: [STUDIO_POLICY.model], origins: [origin] }, constraints: { realtime: { maxSessionDuration: 15 } } });
  }) as typeof fetch);
  const status = await gate.status(request());
  const owner = { userId: user.view.user!.id, claim: (id: string) => s.store.claim(user.request, user.view.user!.id, id), issued: (id: string) => s.store.issued(user.view.user!.id, id) };
  const tokenRequest = (consentVersion = STUDIO_POLICY.consentVersion as string) => request(user.cookie, { attemptId: randomUUID(), consentVersion }, { 'x-studio-access': status.access! });
  await assert.rejects(gate.issue(tokenRequest('old'), owner), { code: 'INVALID_REQUEST' });
  assert.equal((await s.store.me(user.request)).trial, 'ready');
  const results = await Promise.allSettled([gate.issue(tokenRequest(), owner), gate.issue(tokenRequest(), owner)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(calls, 1);
  const view = await s.store.me(user.request); assert.equal(view.trial, 'used');
  assert.equal((await s.store.me(other.request)).history.length, 0);
  const observation = request(other.cookie, { attemptId: view.history[0].id, outcome: 'ended', firstFrameMs: null, providerReportedSeconds: null, localTracksEnded: true }, { 'x-studio-access': status.access! });
  await assert.rejects(gate.observe(observation, other.view.user!.id), { code: 'ATTEMPT_NOT_FOUND' });
});
test('上游未知结果保留待核查权益，客户端错误反馈不能自动恢复免费次数', async () => {
  const s = await setup(), user = await s.signup();
  const gate = new StudioGate(path.join(s.dir, 'studio'), { YINGXIANG_STUDIO_ENABLED: 'true', DECART_API_KEY: 'unit-test-secret' }, (async () => { throw new Error('upstream unknown'); }) as typeof fetch);
  const status = await gate.status(request()), attemptId = randomUUID(), userId = user.view.user!.id;
  await assert.rejects(gate.issue(request(user.cookie, { attemptId, consentVersion: STUDIO_POLICY.consentVersion }, { 'x-studio-access': status.access! }), { userId, claim: (id) => s.store.claim(user.request, userId, id), issued: (id) => s.store.issued(userId, id) }), { code: 'TOKEN_RESULT_UNKNOWN' });
  await s.store.observe(userId, attemptId, 'error');
  assert.equal((await s.store.me(user.request)).trial, 'review');
  await assert.rejects(s.store.claim(user.request, userId, randomUUID()), { code: 'TRIAL_USED' });
});
test('数据文件为测试账号放宽配额后可按剩余次数继续，默认账号仍只有一次', async () => {
  const s = await setup(), user = await s.signup(), other = await s.signup('other'), id = user.view.user!.id;
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data.quotas = { [id]: 3 };
  await writeFile(file, JSON.stringify(data));
  const first = await s.store.me(user.request);
  assert.equal(first.trialLimit, 3); assert.equal(first.trialRemaining, 3); assert.equal(first.trial, 'ready');
  await s.store.claim(user.request, id, randomUUID());
  assert.equal((await s.store.me(user.request)).trialRemaining, 2);
  await s.store.claim(user.request, id, randomUUID());
  assert.equal((await s.store.me(user.request)).trialRemaining, 1);
  await s.store.claim(user.request, id, randomUUID());
  const exhausted = await s.store.me(user.request);
  assert.equal(exhausted.trialRemaining, 0); assert.equal(exhausted.trial, 'review');
  await assert.rejects(s.store.requireTrial(user.request), { code: 'TRIAL_USED' });
  await assert.rejects(s.store.claim(user.request, id, randomUUID()), { code: 'TRIAL_USED' });
  const normal = await s.store.me(other.request);
  assert.equal(normal.trialLimit, 1); assert.equal(normal.trialRemaining, 1);
});
test('配额字段缺省或无效时按默认一次处理', async () => {
  const s = await setup(), user = await s.signup(), id = user.view.user!.id;
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data.quotas = { [id]: 0 };
  await writeFile(file, JSON.stringify(data));
  assert.equal((await s.store.me(user.request)).trialLimit, 1);
  delete data.quotas; data.quotas = { [id]: 1.5 };
  await writeFile(file, JSON.stringify(data));
  assert.equal((await s.store.me(user.request)).trialLimit, 1);
});

test('长时权益按档原子消费，未授权改参不调用供应商或占用15秒，账号互不共享', async () => {
  const s = await setup(), user = await s.signup(), other = await s.signup('other');
  const userId = user.view.user!.id; let calls = 0;
  const gate = new StudioGate(path.join(s.dir, 'studio'), { YINGXIANG_STUDIO_ENABLED: 'true', DECART_API_KEY: 'unit-test-secret' }, (async (_url, init) => {
    calls++;
    const cap = JSON.parse(init!.body as string).constraints.realtime.maxSessionDuration;
    return Response.json({ apiKey: 'unit-test-ephemeral', expiresAt: new Date(Date.now() + 9000).toISOString(), permissions: { models: [STUDIO_POLICY.model], origins: [origin] }, constraints: { realtime: { maxSessionDuration: cap } } });
  }) as typeof fetch);
  const status = await gate.status(request());
  const owner = { userId, claim: (id: string, seconds: 15 | 30 | 60) => s.store.claim(user.request, userId, id, seconds), issued: (id: string) => s.store.issued(userId, id) };
  const connect = (durationSec: number) => gate.issue(request(user.cookie, { attemptId: randomUUID(), consentVersion: STUDIO_POLICY.consentVersion, durationSec }, { 'x-studio-access': status.access! }), owner);
  for (const seconds of [30, 60]) await assert.rejects(connect(seconds), { code: 'DURATION_UNAVAILABLE' });
  assert.equal(calls, 0); assert.equal((await s.store.me(user.request)).trialRemaining, 1);
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data.durationQuotas = { [userId]: { 30: 1, 60: 1 } }; await writeFile(file, JSON.stringify(data));
  for (const seconds of [30, 60]) {
    const results = await Promise.allSettled([connect(seconds), connect(seconds)]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  }
  assert.equal(calls, 2);
  const view = await s.store.me(user.request);
  assert.equal(view.trialRemaining, 1);
  assert.deepEqual(view.durations.map((item) => item.remaining), [1, 0, 0]);
  assert.deepEqual(view.history.map((item) => item.durationSec).sort(), [30, 60]);
  await assert.rejects(s.store.claim(other.request, other.view.user!.id, randomUUID(), 60), { code: 'DURATION_UNAVAILABLE' });
});

test('长时签发未知后仍待核查，不返还同档次数，不消费免费档，重启保持', async () => {
  const s = await setup(), user = await s.signup(), userId = user.view.user!.id;
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data.durationQuotas = { [userId]: { 60: 1 } }; await writeFile(file, JSON.stringify(data));
  const gate = new StudioGate(path.join(s.dir, 'studio'), { YINGXIANG_STUDIO_ENABLED: 'true', DECART_API_KEY: 'unit-test-secret' }, (async () => { throw new Error('unknown upstream'); }) as typeof fetch);
  const status = await gate.status(request());
  await assert.rejects(gate.issue(request(user.cookie, { attemptId: randomUUID(), consentVersion: STUDIO_POLICY.consentVersion, durationSec: 60 }, { 'x-studio-access': status.access! }), {
    userId, claim: (id, seconds) => s.store.claim(user.request, userId, id, seconds), issued: (id) => s.store.issued(userId, id),
  }), { code: 'TOKEN_RESULT_UNKNOWN' });
  const reloaded = new AccountStore(path.join(s.dir, 'accounts'));
  const view = await reloaded.me(user.request);
  assert.equal(view.history[0].durationSec, 60); assert.equal(view.history[0].state, 'review');
  assert.equal(view.trialRemaining, 1); assert.equal(view.durations[2].remaining, 0);
  await assert.rejects(reloaded.requireTrial(user.request, 60), { code: 'DURATION_UNAVAILABLE' });
});

test('历史缺省时长按15秒，不恢复免费次数，非法长时配额不生效且客户端不能发放', async () => {
  const s = await setup(), user = await s.signup(), id = user.view.user!.id;
  await s.store.claim(user.request, id, randomUUID());
  const file = path.join(s.dir, 'accounts/store.json'), data = JSON.parse(await readFile(file, 'utf8'));
  delete data.attempts[0].durationSec;
  data.durationQuotas = { [id]: { 30: -1, 60: 1.5 } }; await writeFile(file, JSON.stringify(data));
  const view = await s.store.me(user.request);
  assert.deepEqual(view.durations.map((item) => item.remaining), [0, 0, 0]);
  assert.equal(view.history[0].durationSec, 15);
  await assert.rejects(s.store.authenticate(request('', { username: 'evil', password, durationQuotas: { 60: 999 } }), true), { code: 'INVALID_ACCOUNT' });
});
