import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { PromptSession } from '../src/lib/prompt/session';
import { PROMPT_EXAMPLES, promptText } from '../src/lib/prompt/policy';
import { DecartPromptAdapter, preparePromptSdk, type PromptAdapter, type PromptConnectOptions } from '../src/lib/prompt/adapter';
import { LocalCamera } from '../src/lib/media/local-camera';
import { RemotePreview } from '../src/lib/media/remote-preview';
import { composePrompt, MAX_INSTRUCTIONS, promptStateText } from '../src/lib/prompt/composition';
import type { RealtimeSdkFactory } from '../src/lib/media/decart-realtime';
import { safeConnectionStage, type ConnectionStage } from '../src/lib/prompt/connection-diagnostics';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('实时编辑可选择30秒，实际播放后开始计时且同连接更新不续时', async () => {
  const s=sessionSetup(),wait=deferred();s.controller.setDuration(30);s.connectWait(wait.promise);
  const pending=s.controller.start();s.setNow(2000);wait.resolve();await pending;
  assert.equal(s.connections[0].durationSec,30);
  assert.equal(s.controller.getSnapshot().deadlineAt,32000);
  s.controller.setDuration(15);assert.equal(s.controller.getSnapshot().durationSec,30);
  s.setNow(12000);s.controller.tick();assert.equal(s.controller.getSnapshot().remaining,20);
  s.controller.syncComposition('更换背景');await settle();
  assert.equal(s.controller.getSnapshot().deadlineAt,32000);s.controller.dispose();
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test('作品记录初始及确认后的用户组合，保留删除前状态，不记录草稿或未发送的中间合并', async () => {
  const s = sessionSetup();
  const original = ['换成米白针织衫', '保留人物面部'];
  s.controller.setDraft(composePrompt(original.map((text, id) => ({ id, text }))), original);
  assert.deepEqual(s.controller.getSnapshot().history, []);
  await s.controller.start(); original[0] = '外部变化不能污染历史';
  const wait = deferred(); s.updateWait(wait.promise); s.setNow(3000);
  s.controller.syncComposition('下一组合', ['保留人物面部']);
  s.controller.syncComposition('被合并的中间状态', ['未实际发送']);
  s.controller.syncComposition('最后组合', ['保留人物面部', '服装改深蓝']);
  assert.equal(s.controller.getSnapshot().history.length, 1);
  wait.resolve(); await settle();
  assert.deepEqual(s.controller.getSnapshot().history, [
    { atMs: 0, instructions: ['换成米白针织衫', '保留人物面部'] },
    { atMs: 3000, instructions: ['保留人物面部'] },
    { atMs: 3000, instructions: ['保留人物面部', '服装改深蓝'] },
  ]);
  s.controller.setDraft('未发送草稿');
  s.controller.syncComposition('', []);
  assert.equal(s.controller.getSnapshot().history.length, 3); s.controller.dispose();
});

test('失败及取消后的迟到更新不写作品提示词，新一轮只保留本轮记录', async () => {
  const s = sessionSetup(); await s.controller.start();
  s.failUpdate(); s.controller.syncComposition('失败组合', ['不应记录']); await settle();
  assert.equal(s.controller.getSnapshot().history.length, 1); s.controller.dispose();
  const t = sessionSetup(); await t.controller.start(); const wait = deferred(); t.updateWait(wait.promise);
  t.controller.syncComposition('旧更新', ['旧组合']); t.controller.stop();
  t.controller.setDraft('新一轮', ['新组合']); await t.controller.start();
  wait.resolve(); await settle();
  assert.deepEqual(t.controller.getSnapshot().history, [{ atMs: 0, instructions: ['新组合'] }]);
  t.controller.dispose();
});
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

test('连接中明确应用的新指令在出画后更新；独立建连超时不复活', async () => {
  const s = sessionSetup(), wait = deferred(); s.connectWait(wait.promise); const running = s.controller.start();
  s.controller.setDraft('背景换成客厅'); s.controller.apply(); assert.equal(s.updates.length, 0);
  wait.resolve(); await running; await settle(); assert.deepEqual(s.updates, ['背景换成客厅']);
  s.setNow(15_000); s.controller.tick(); assert.equal(s.controller.getSnapshot().phase, 'ended'); assert.equal(s.connections[0].signal.aborted, true); s.controller.dispose();
  const t = sessionSetup(), slow = deferred(); t.connectWait(slow.promise); const pending = t.controller.start(); t.setNow(30001); t.controller.tick(); slow.resolve(); await pending;
  assert.equal(t.controller.getSnapshot().phase, 'error'); assert.equal(t.controller.getSnapshot().remaining, 15); assert.equal(t.controller.getSnapshot().deadlineAt, null); assert.equal(t.controller.getSnapshot().applied, null); t.controller.dispose();
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
async function adapterSetup(options: { pending?: boolean; badUpdate?: boolean; failToken?: boolean; deferRemotePlayback?: boolean } = {}) {
  const local = media(), output = media(), camera = new LocalCamera(async () => local.stream), remote = new RemotePreview();
  camera.subscribe(() => { const stream = camera.getSnapshot(); if (stream) queueMicrotask(() => camera.markPlaying(stream)); });
  await camera.start(new AbortController().signal, () => {});
  let provider!: () => Promise<string>, args!: RealTimeClientConnectOptions, disconnects = 0;
  const requests: Array<{ url: string; body?: unknown }> = [], updates: unknown[] = [], wait = deferred();
  remote.subscribe(() => { const stream = remote.getSnapshot(); if (stream && !options.deferRemotePlayback) queueMicrotask(() => remote.markPlaying(stream)); });
  const client = { on() {}, disconnect() { disconnects++; }, async set(value: unknown) { if (options.badUpdate) throw new Error('private-unit-secret RAWDIAGNOSTIC'); updates.push(value); } } as unknown as RealTimeClient;
  const factory: RealtimeSdkFactory = async (callback) => {
    provider = callback;
    return { model: {} as ModelDefinition, async connect(_stream, connectOptions) { args = connectOptions; await callback(); if (options.pending) await wait.promise; connectOptions.onRemoteStream(output.stream); return client; } };
  };
  const request: typeof fetch = async (input, init) => {
    const target = String(input); requests.push({ url: target, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return target.endsWith('/status') ? Response.json({ code: 0, data: { available: true, access: 'unit-access' }, message: 'ok' }) : options.failToken ? Response.json({ code: 50300, data: null, message: '签发结果待核查' }, { status: 503 }) : Response.json({ code: 0, data: { apiKey: 'ek_unit_test_only', durationSec: 15 }, message: 'ok' });
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
  assert.ok(connector.model); assert.match(JSON.stringify(connector.model), /lucy-2.6/); assert.equal(called, false);
});

test('组合保留当前顺序与完整内容，支持12条500字且不会静默截断', () => {
  assert.equal(composePrompt([]), '');
  const items = Array.from({ length: MAX_INSTRUCTIONS }, (_, index) => ({ id: index + 1, text: `${index}`.padEnd(500, '字') }));
  const prompt = composePrompt(items);
  assert.ok(prompt.length > 6000);
  assert.equal(promptStateText(prompt), prompt);
  assert.ok(prompt.endsWith(items[11].text));
  assert.throws(() => composePrompt([...items, { id: 13, text: '额外' }]));
  assert.throws(() => composePrompt([{ id: 1, text: '字'.repeat(501) }]));
  assert.throws(() => promptStateText('字'.repeat(6501)));
});

test('增删组合发送完整剩余状态，同连接串行合并且不重新签发或续时', async () => {
  const s = sessionSetup(), a = { id: 1, text: '背景变成花园' }, b = { id: 2, text: '添加一盆植物' }, c = { id: 3, text: '衣服变成白色' };
  s.controller.syncComposition(composePrompt([a]));
  assert.equal(s.connections.length, 0);
  await s.controller.start(); const deadline = s.controller.getSnapshot().deadlineAt;
  const wait = deferred(); s.updateWait(wait.promise);
  s.controller.syncComposition(composePrompt([a, b]));
  s.controller.syncComposition(composePrompt([a, b, c]));
  s.controller.syncComposition(composePrompt([a, c]));
  wait.resolve(); await settle();
  assert.deepEqual(s.updates, [composePrompt([a, b]), composePrompt([a, c])]);
  assert.doesNotMatch(s.updates[1], /植物/);
  assert.equal(s.connections.length, 1); assert.equal(s.controller.getSnapshot().deadlineAt, deadline);
  assert.equal(s.controller.getSnapshot().applied, composePrompt([a, c])); s.controller.dispose();
});

test('连接中增删发送最新组合，清空会中止迟到连接且不自动再开', async () => {
  const s = sessionSetup(), wait = deferred(), a = { id: 1, text: '花园' }, b = { id: 2, text: '白衣' };
  s.controller.syncComposition(composePrompt([a])); s.connectWait(wait.promise);
  const pending = s.controller.start();
  s.controller.syncComposition(composePrompt([a, b])); s.controller.syncComposition(composePrompt([b]));
  wait.resolve(); await pending; await settle();
  assert.deepEqual(s.updates, [composePrompt([b])]);
  s.controller.syncComposition(''); assert.equal(s.controller.getSnapshot().phase, 'ended');
  assert.equal(s.connections[0].signal.aborted, true); assert.equal(s.controller.getSnapshot().draft, '');
  s.controller.syncComposition(composePrompt([a])); assert.equal(s.connections.length, 1); s.controller.dispose();
  const t = sessionSetup(), late = deferred(); t.connectWait(late.promise); const connecting = t.controller.start();
  t.controller.syncComposition(''); late.resolve(); await connecting;
  assert.equal(t.controller.getSnapshot().phase, 'ended'); assert.equal(t.controller.getSnapshot().applied, null); t.controller.dispose();
});

test('组合在SDK适配器中完整透传，更新失败保留本地目标并停止旧画面', async () => {
  const s = await adapterSetup(), controller = new PromptSession(s.adapter);
  const first = composePrompt([{ id: 1, text: '花园'.repeat(250) }, { id: 2, text: '白衣'.repeat(250) }]);
  controller.syncComposition(first); controller.setConsent(true); await controller.start();
  assert.deepEqual(s.options().initialState, { prompt: { text: first, enhance: false } });
  const next = composePrompt([{ id: 2, text: '白衣'.repeat(250) }]); controller.syncComposition(next); await settle();
  assert.deepEqual(s.updates, [{ prompt: next, enhance: false }]);
  assert.equal(s.requests.filter(item => item.url.endsWith('/token')).length, 1);
  controller.syncComposition(''); assert.equal(s.remote.getSnapshot(), null); assert.equal(s.local.track.readyState, 'live');
  controller.dispose(); s.camera.stop();
  const t = sessionSetup(); await t.controller.start(); const previous = t.controller.getSnapshot().applied;
  t.failUpdate(); t.controller.syncComposition(next); await settle();
  assert.equal(t.controller.getSnapshot().phase, 'error'); assert.equal(t.controller.getSnapshot().draft, next);
  assert.equal(t.controller.getSnapshot().applied, previous); assert.equal(t.connections.length, 1); t.controller.dispose();
});

test('连接超时保留固定阶段与相对耗时，迟到或未知诊断不能覆盖结果', async () => {
  const s = sessionSetup(), wait = deferred(); s.connectWait(wait.promise);
  const pending = s.controller.start();
  const progress = s.connections[0].onProgress!;
  progress('checkingService'); s.setNow(2800); progress('tokenReady');
  progress('tokenReady'); progress('secret-token-prompt-raw' as ConnectionStage);
  assert.deepEqual(s.controller.getSnapshot().connectionSteps, [{stage:'checkingService',elapsedMs:0},{stage:'tokenReady',elapsedMs:2800}]);
  s.setNow(30_000); s.controller.tick();
  assert.match(s.controller.getSnapshot().message ?? '', /令牌已取得，等待模型连接/);
  progress('playing'); wait.resolve(); await pending;
  assert.equal(s.controller.getSnapshot().phase, 'error');
  assert.equal(s.controller.getSnapshot().connectionSteps.at(-1)?.stage, 'tokenReady');
  assert.doesNotMatch(JSON.stringify(s.controller.getSnapshot()), /secret-token-prompt-raw/);
  s.controller.dispose();
});

test('等待服务方视频实际播放才开启15秒计时，连接等待及组合更新不扣减或续时', async () => {
  const s = sessionSetup(), wait = deferred(); s.connectWait(wait.promise);
  const pending = s.controller.start();
  s.setNow(20_000); s.controller.tick();
  assert.equal(s.controller.getSnapshot().phase, 'connecting');
  assert.equal(s.controller.getSnapshot().remaining, 15);
  assert.equal(s.controller.getSnapshot().deadlineAt, null);
  s.controller.syncComposition(composePrompt([{id:1,text:'白色上衣'}]));
  s.setNow(25_000); wait.resolve(); await pending; await settle();
  assert.equal(s.controller.getSnapshot().phase, 'live');
  assert.equal(s.controller.getSnapshot().deadlineAt, 40_000);
  s.setNow(30_000); s.controller.tick(); assert.equal(s.controller.getSnapshot().remaining, 10);
  s.controller.syncComposition(composePrompt([{id:1,text:'花园背景'}])); await settle();
  assert.equal(s.controller.getSnapshot().deadlineAt, 40_000); assert.equal(s.connections.length, 1);
  s.setNow(40_000); s.controller.tick(); assert.equal(s.controller.getSnapshot().phase, 'ended'); s.controller.dispose();
});

test('计时器未及时触发时，超过建连期限才返回的视频也不能开启体验计时', async () => {
  const s = sessionSetup(), wait = deferred(); s.connectWait(wait.promise); const pending = s.controller.start();
  s.setNow(30_001); wait.resolve(); await pending;
  assert.equal(s.controller.getSnapshot().phase, 'error'); assert.equal(s.controller.getSnapshot().deadlineAt, null);
  assert.match(s.controller.getSnapshot().message ?? '', /连接等待超过30秒/); s.controller.dispose();
});

test('令牌与远端流到达均不启动倒计时，远端实际playing后才开始15秒', async () => {
  const s = await adapterSetup({deferRemotePlayback:true}); let now = 0;
  const controller = new PromptSession(s.adapter, () => now);
  controller.setDraft('白色上衣'); controller.setConsent(true);
  const pending = controller.start();
  for (let i=0; i<20 && !s.remote.getSnapshot(); i++) await settle();
  assert.ok(s.remote.getSnapshot());
  now = 20_000; controller.tick();
  assert.equal(controller.getSnapshot().phase, 'connecting');
  assert.equal(controller.getSnapshot().deadlineAt, null); assert.equal(controller.getSnapshot().remaining, 15);
  s.remote.markPlaying(s.remote.getSnapshot()!); await pending;
  assert.equal(controller.getSnapshot().phase, 'live'); assert.equal(controller.getSnapshot().deadlineAt, 35_000);
  now = 25_000; controller.tick(); assert.equal(controller.getSnapshot().remaining, 10);
  controller.dispose(); s.camera.stop();
});

test('SDK阶段只识别固定消息名，适配器区分签发、远端流与实际播放', async () => {
  assert.equal(safeConnectionStage('realtime connect: starting'), 'signaling');
  assert.equal(safeConnectionStage('signaling: websocket closed'), 'socketClosed');
  assert.equal(safeConnectionStage('signaling: livekit_room_info timeout'), 'roomTimeout');
  assert.equal(safeConnectionStage('raw key, prompt and error text'), null);
  const s = await adapterSetup(); const steps: ConnectionStage[] = [];
  await s.adapter.connect({prompt:'测试草稿',signal:new AbortController().signal,onError(){},onProgress(stage){steps.push(stage);}});
  assert.deepEqual(steps, ['checkingService','preparingSdk','requestingToken','tokenReady','remoteStream','playing']);
  assert.doesNotMatch(JSON.stringify(steps), /ek_unit|测试草稿/);
  s.adapter.stop(); s.camera.stop();
});
