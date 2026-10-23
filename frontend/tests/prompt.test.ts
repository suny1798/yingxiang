import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { PromptSession } from '../src/lib/prompt/session';
import { PROMPT_POLICY, PROMPT_EXAMPLES, promptText } from '../src/lib/prompt/policy';
import { DecartPromptAdapter, preparePromptSdk, type PromptAdapter, type PromptConnectOptions } from '../src/lib/prompt/adapter';
import { LocalCamera } from '../src/lib/media/local-camera';
import { RemotePreview } from '../src/lib/media/remote-preview';
import type { RealtimeSdkFactory } from '../src/lib/media/decart-realtime';
import { PromptGate } from '../src/lib/server/prompt-gate';
import { StudioError } from '../src/lib/server/studio-gate';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
function sessionSetup() {
  let now = 0, stops = 0, connectWait: Promise<void> | null = null, updateWait: Promise<void> | null = null, updateError = false;
  const connections: PromptConnectOptions[] = [], updates: string[] = [];
  const adapter: PromptAdapter = { async connect(options) { connections.push(options); if (connectWait) await connectWait; }, async update(prompt) { updates.push(prompt); if (updateWait) await updateWait; if (updateError) throw new Error('更新未完成'); }, stop() { stops++; } };
  const controller = new PromptSession(adapter, () => now);
  controller.setDraft('把背景改成花园'); controller.setConsent(true);
  return { controller, connections, updates, stops: () => stops, setNow(value: number) { now = value; }, connectWait(value: Promise<void>) { connectWait = value; }, updateWait(value: Promise<void>) { updateWait = value; }, failUpdate() { updateError = true; } };
}

test('提示词空白/长度校验；示例是合法草稿，不会自动连接或发送', async () => {
  for (const value of ['', '   ', '字'.repeat(501)]) assert.throws(() => promptText(value));
  assert.equal(promptText('  花园  '), '花园');
  const s = sessionSetup();
  for (const example of PROMPT_EXAMPLES) { s.controller.setDraft(example.text); assert.equal(promptText(s.controller.getSnapshot().draft), example.text); }
  assert.equal(s.connections.length, 0); assert.equal(s.updates.length, 0);
  s.controller.setDraft('  '); await s.controller.start(); assert.equal(s.connections.length, 0);
  s.controller.setDraft('花园'); s.controller.setConsent(false); await s.controller.start(); assert.equal(s.connections.length, 0); s.controller.dispose();
});

test('修改草稿不自动发送，明确应用才更新；快速应用串行合并末次且不续时', async () => {
  const s = sessionSetup(); await s.controller.start(); const deadline = s.controller.getSnapshot().deadlineAt;
  const wait = deferred(); s.updateWait(wait.promise);
  s.controller.setDraft('  换成毛衣  '); assert.deepEqual(s.updates, []);
  s.controller.apply(); s.controller.setDraft('变成海滩'); s.controller.apply(); s.controller.setDraft('加一盆植物'); s.controller.apply();
  assert.deepEqual(s.updates, ['换成毛衣']); wait.resolve(); await settle();
  assert.deepEqual(s.updates, ['换成毛衣', '加一盆植物']); assert.equal(s.controller.getSnapshot().applied, '加一盆植物');
  assert.equal(s.controller.getSnapshot().deadlineAt, deadline); assert.equal(s.connections.length, 1);
  s.controller.apply(); await settle(); assert.equal(s.updates.length, 2); s.controller.dispose();
});

test('连接中明确应用的新指令在出画后更新；截止含连接准备且超时不复活', async () => {
  const s = sessionSetup(), wait = deferred(); s.connectWait(wait.promise); const running = s.controller.start();
  s.controller.setDraft('背景换成客厅'); s.controller.apply(); assert.equal(s.updates.length, 0);
  wait.resolve(); await running; await settle(); assert.deepEqual(s.updates, ['背景换成客厅']);
  s.setNow(15_000); s.controller.tick(); assert.equal(s.controller.getSnapshot().phase, 'ended'); assert.equal(s.connections[0].signal.aborted, true); s.controller.dispose();
  const t = sessionSetup(), slow = deferred(); t.connectWait(slow.promise); const pending = t.controller.start(); t.setNow(15001); t.controller.tick(); slow.resolve(); await pending;
  assert.equal(t.controller.getSnapshot().phase, 'ended'); assert.equal(t.controller.getSnapshot().applied, null); t.controller.dispose();
});

test('取消同意和更新失败都终止连接；迟到更新不能覆盖重开的新会话', async () => {
  const s = sessionSetup(); await s.controller.start(); const wait = deferred(); s.updateWait(wait.promise);
  s.controller.setDraft('旧的更新'); s.controller.apply(); s.controller.setConsent(false); assert.equal(s.controller.getSnapshot().phase, 'ended');
  s.controller.setDraft('新的指令'); s.controller.setConsent(true); await s.controller.start(); wait.resolve(); await settle();
  assert.equal(s.controller.getSnapshot().applied, '新的指令'); s.controller.dispose();
  const t = sessionSetup(); await t.controller.start(); t.failUpdate(); t.controller.setDraft('更新'); t.controller.apply(); await settle();
  assert.equal(t.controller.getSnapshot().phase, 'error'); assert.equal(t.connections.length, 1); assert.equal(t.connections[0].signal.aborted, true); t.controller.dispose();
});

interface TestMedia { track: EventTarget & { readyState: string; stops: number; stop(): void }; stream: MediaStream; clones: TestMedia[] }
function media(): TestMedia {
  class Track extends EventTarget { readyState = 'live'; stops = 0; stop() { this.stops++; this.readyState = 'ended'; } }
  const track = new Track(), clones: TestMedia[] = [];
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [], clone: () => { const value = media(); clones.push(value); return value.stream; } } as unknown as MediaStream;
  return { track, stream, clones };
}
async function adapterSetup(options: { pending?: boolean; badUpdate?: boolean; failToken?: boolean } = {}) {
  const local = media(), output = media(), camera = new LocalCamera(async () => local.stream), remote = new RemotePreview();
  camera.subscribe(() => { const stream = camera.getSnapshot(); if (stream) queueMicrotask(() => camera.markPlaying(stream)); });
  await camera.start(new AbortController().signal, () => {});
  let provider!: () => Promise<string>, args!: RealTimeClientConnectOptions, disconnects = 0;
  const requests: Array<{ url: string; body?: unknown }> = [], updates: unknown[] = [], wait = deferred();
  remote.subscribe(() => { const stream = remote.getSnapshot(); if (stream) queueMicrotask(() => remote.markPlaying(stream)); });
  const client = { on() {}, disconnect() { disconnects++; }, async set(value: unknown) { if (options.badUpdate) throw new Error('private-unit-secret RAWDIAGNOSTIC'); updates.push(value); } } as unknown as RealTimeClient;
  const factory: RealtimeSdkFactory = async (callback) => {
    provider = callback;
    return { model: {} as ModelDefinition, async connect(_stream, connectOptions) { args = connectOptions; await callback(); if (options.pending) await wait.promise; connectOptions.onRemoteStream(output.stream); return client; } };
  };
  const request: typeof fetch = async (input, init) => {
    const target = String(input); requests.push({ url: target, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return target.endsWith('/status') ? Response.json({ available: true, access: 'unit-access' }) : options.failToken ? Response.json({ error: { message: '签发结果待核查' } }, { status: 503 }) : Response.json({ apiKey: 'ek_unit_test_only', durationSec: 15 });
  };
  return { adapter: new DecartPromptAdapter(camera, remote, request, factory), camera, local, remote, output, requests, updates, options: () => args, provider: () => provider(), disconnects: () => disconnects, finish: wait.resolve };
}

test('提示词适配器仅纯文字完整状态、一个令牌、标准档，停止保留原画并回收克隆', async () => {
  const s = await adapterSetup(), controller = new PromptSession(s.adapter); controller.setDraft('  背景改成花园  '); controller.setConsent(true);
  await controller.start(); assert.equal(controller.getSnapshot().phase, 'live');
  assert.deepEqual(s.options().initialState, { prompt: { text: '背景改成花园', enhance: false } });
  assert.equal(s.options().retries, 0); assert.equal(s.options().capacityRetryBudgetMs, 0); assert.equal(s.options().speed, undefined); assert.equal(s.options().resolution, '720p');
  assert.deepEqual(s.requests.map((item) => item.url), ['/api/prompt/status', '/api/prompt/token']);
  assert.doesNotMatch(JSON.stringify(s.requests), /背景|花园|image/);
  await assert.rejects(s.provider(), /unauthorized/); controller.setDraft('换成客厅'); controller.apply(); await settle(); assert.deepEqual(s.updates, [{ prompt: '换成客厅', enhance: false }]);
  controller.stop(); assert.equal(s.local.track.readyState, 'live'); assert.equal(s.local.clones[0].track.readyState, 'ended'); assert.equal(s.output.track.readyState, 'ended'); assert.equal(s.disconnects(), 1);
  assert.equal(s.requests.length, 2); controller.dispose(); s.camera.stop();
});

test('提示词连接取消清理迟到客户端/远端；签发或更新失败不重试、不回显SDK正文', async () => {
  const s = await adapterSetup({ pending: true }), controller = new PromptSession(s.adapter); controller.setDraft('指令'); controller.setConsent(true); const pending = controller.start();
  for (let index = 0; index < 20 && !s.options(); index++) await settle(); controller.stop(); s.finish(); await pending;
  assert.equal(controller.getSnapshot().phase, 'ended'); assert.equal(s.output.track.readyState, 'ended'); assert.equal(s.disconnects(), 1); assert.equal(s.local.track.readyState, 'live'); controller.dispose(); s.camera.stop();
  for (const options of [{ badUpdate: true }, { failToken: true }]) {
    const t = await adapterSetup(options), session = new PromptSession(t.adapter); session.setDraft('指令'); session.setConsent(true); await session.start();
    if (options.badUpdate) { session.setDraft('第二条'); session.apply(); await settle(); }
    assert.equal(session.getSnapshot().phase, 'error'); assert.doesNotMatch(session.getSnapshot().message ?? '', /private-unit-secret|RAWDIAGNOSTIC/); assert.equal(t.requests.filter((item) => item.url.endsWith('/token')).length, 1);
    session.dispose(); t.camera.stop();
  }
});

test('本机已安装SDK能解析固定Lucy2.5模型，准备组件不会签发或建连', async () => {
  let called = false; const connector = await preparePromptSdk(async () => { called = true; throw new Error(); });
  assert.ok(connector.model); assert.match(JSON.stringify(connector.model), /lucy-2.5/); assert.equal(called, false);
});

const origin = 'http://127.0.0.1:8787', user = randomUUID();
const environment = { YINGXIANG_PROMPT_ENABLED: 'true', YINGXIANG_PROMPT_BUDGET_USD: '0.60', YINGXIANG_PROMPT_MAX_SESSIONS: '2', DECART_API_KEY: 'unit-permanent-secret' };
const get = () => new Request(`${origin}/api/prompt/status`, { headers: { host: '127.0.0.1:8787' } });
const request = (access?: string, changes: Record<string, unknown> = {}) => new Request(`${origin}/api/prompt/token`, { method: 'POST', headers: { host: '127.0.0.1:8787', origin, 'content-type': 'application/json', 'x-studio-access': access ?? '' }, body: JSON.stringify({ attemptId: randomUUID(), consentVersion: PROMPT_POLICY.consentVersion, durationSec: 15, ...changes }) });
const code = (value: string) => (error: unknown) => error instanceof StudioError && error.code === value;
async function gateSetup(options: { env?: Record<string, string>; unknown?: boolean; invalid?: 'model' | 'origin' | 'duration' | 'ttl' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-prompt-')), sent: unknown[] = [];
  const upstream: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.decart.ai/v1/client/tokens'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('X-API-KEY'), 'unit-permanent-secret');
    sent.push(JSON.parse(String(init?.body)));
    if (options.unknown) throw new Error('unit-permanent-secret RAWDIAGNOSTIC');
    return Response.json({ apiKey: 'ek_unit_ephemeral', expiresAt: new Date(Date.now() + (options.invalid === 'ttl' ? 90_000 : 9000)).toISOString(), permissions: { models: [options.invalid === 'model' ? 'lucy-vton-3.6' : 'lucy-2.5'], origins: [options.invalid === 'origin' ? 'https://other.example' : origin] }, constraints: { realtime: { maxSessionDuration: options.invalid === 'duration' ? 60 : 15 } } });
  };
  return { directory, sent, upstream, gate: new PromptGate(directory, options.env ?? environment, upstream) };
}

test('独立开关/预算/密钥/次数缺失默认关闭，匿名不返回访问凭据', async () => {
  for (const env of [{}, { ...environment, YINGXIANG_PROMPT_ENABLED: 'false' }, { ...environment, YINGXIANG_PROMPT_BUDGET_USD: '0' }, { ...environment, YINGXIANG_PROMPT_MAX_SESSIONS: '0' }, { ...environment, DECART_API_KEY: '' }]) {
    const s = await gateSetup({ env }); const status = await s.gate.status(get(), user); assert.equal(status.available, false); assert.equal(status.access, undefined); await assert.rejects(s.gate.issue(request(), user), code('PROMPT_DISABLED')); assert.equal(s.sent.length, 0);
  }
  const s = await gateSetup(); assert.equal((await s.gate.status(get(), null)).access, undefined); assert.ok((await s.gate.status(get(), user)).access);
});

test('错误来源/凭据/确认版本、非15秒及注入模型/提示词均在上游前拒绝', async () => {
  const s = await gateSetup(), { access } = await s.gate.status(get(), user);
  const cross = request(access); cross.headers.set('origin', 'https://other.example'); await assert.rejects(s.gate.issue(cross, user), code('ORIGIN_REJECTED'));
  await assert.rejects(s.gate.issue(request('bad'), user), code('PROMPT_UNAUTHORIZED'));
  for (const changes of [{ durationSec: 60 }, { consentVersion: 'old' }, { model: 'other' }, { prompt: 'private words' }]) await assert.rejects(s.gate.issue(request(access, changes), user), code('INVALID_PROMPT_SESSION'));
  assert.equal(s.sent.length, 0);
});

test('并发全局预留、同UUID不重发、重启保持预算；仅固定模型/Origin/15秒短令牌', async () => {
  const s = await gateSetup(), { access } = await s.gate.status(get(), user), id = randomUUID();
  const results = await Promise.allSettled([s.gate.issue(request(access, { attemptId: id }), user), s.gate.issue(request(access), randomUUID())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0], { expiresIn: 10, allowedModels: ['lucy-2.5'], allowedOrigins: [origin], constraints: { realtime: { maxSessionDuration: 15 } } });
  const file = path.join(s.directory, 'limits.json'), ledger = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(ledger.attempts[0].estimateUsd, .30); assert.doesNotMatch(JSON.stringify(ledger), /unit-permanent-secret|ek_unit_ephemeral|prompt|RAWDIAGNOSTIC/);
  const restarted = new PromptGate(s.directory, environment, s.upstream);
  await assert.rejects(restarted.issue(request(access, { attemptId: ledger.attempts[0].id }), user), code('PROMPT_ATTEMPT_SPENT'));
  assert.equal((await restarted.status(get(), user)).available, false);
  ledger.attempts[0].leaseUntil = 0; await writeFile(file, JSON.stringify(ledger));
  assert.equal((await restarted.status(get(), user)).available, true); await restarted.issue(request(access), user);
  assert.equal((await restarted.status(get(), user)).available, false); assert.equal(s.sent.length, 2);
});

test('返回模型/来源/时长/TTL不符或上游失败留unknown，未知占用预算且阻止重试', async () => {
  for (const options of [{ unknown: true }, { invalid: 'model' as const }, { invalid: 'origin' as const }, { invalid: 'duration' as const }, { invalid: 'ttl' as const }]) {
    const s = await gateSetup(options), { access } = await s.gate.status(get(), user), id = randomUUID();
    await assert.rejects(s.gate.issue(request(access, { attemptId: id }), user), code('PROMPT_TOKEN_UNKNOWN'));
    await assert.rejects(s.gate.issue(request(access, { attemptId: id }), user), code('PROMPT_ATTEMPT_SPENT'));
    await assert.rejects(s.gate.issue(request(access), user), code('PROMPT_LIMIT')); assert.equal(s.sent.length, 1);
    const text = await readFile(path.join(s.directory, 'limits.json'), 'utf8'); assert.equal(JSON.parse(text).attempts[0].state, 'unknown'); assert.doesNotMatch(text, /unit-permanent-secret|ek_unit_ephemeral|RAWDIAGNOSTIC/);
  }
});

test('损坏的额度记录失败关闭，不可重建空账本重新赠送', async () => {
  const s = await gateSetup(); await s.gate.status(get(), user); const file = path.join(s.directory, 'limits.json'); await writeFile(file, 'broken');
  await assert.rejects(s.gate.status(get(), user), code('PROMPT_STORE_UNAVAILABLE')); assert.equal(await readFile(file, 'utf8'), 'broken'); assert.equal(s.sent.length, 0);
});

test('总预算与有限次数分别约束；连接窗口过后也不退回或重置用量', async () => {
  for (const env of [{ ...environment, YINGXIANG_PROMPT_BUDGET_USD: '0.30', YINGXIANG_PROMPT_MAX_SESSIONS: '20' }, { ...environment, YINGXIANG_PROMPT_BUDGET_USD: '5', YINGXIANG_PROMPT_MAX_SESSIONS: '1' }]) {
    const s = await gateSetup({ env }), { access } = await s.gate.status(get(), user);
    await s.gate.issue(request(access), user);
    const file = path.join(s.directory, 'limits.json'), ledger = JSON.parse(await readFile(file, 'utf8')); ledger.attempts[0].leaseUntil = 0; await writeFile(file, JSON.stringify(ledger));
    assert.equal((await s.gate.status(get(), user)).available, false); await assert.rejects(s.gate.issue(request(access), user), code('PROMPT_LIMIT')); assert.equal(s.sent.length, 1);
  }
});
