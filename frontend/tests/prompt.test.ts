import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { PromptSession } from '../src/lib/prompt/session';
import { PROMPT_EXAMPLES, promptText } from '../src/lib/prompt/policy';
import { DecartPromptAdapter, preparePromptSdk, type PromptAdapter, type PromptConnectOptions } from '../src/lib/prompt/adapter';
import { LocalCamera } from '../src/lib/media/local-camera';
import { RemotePreview } from '../src/lib/media/remote-preview';
import type { RealtimeSdkFactory } from '../src/lib/media/decart-realtime';

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
