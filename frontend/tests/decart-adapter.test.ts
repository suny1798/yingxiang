import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelDefinition, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';
import { LocalCamera } from '../src/lib/media/local-camera';
import { RemotePreview } from '../src/lib/media/remote-preview';
import { STUDIO_POLICY } from '../src/lib/studio/policy';
import { DecartTryOnAdapter, safeSdkDiagnostic, type RealtimeSdkFactory } from '../src/lib/try-on/decart-adapter';
import { SessionController } from '../src/lib/try-on/session-controller';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const garment = { id: 'test', name: 'test.png', previewUrl: 'blob:test', blob: new Blob(['unit test image'], { type: 'image/png' }) };
function media() {
  class Track extends EventTarget { readyState = 'live'; stops = 0; stop() { this.stops++; this.readyState = 'ended'; } }
  const track = new Track();
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [], clone: () => media().stream } as unknown as MediaStream };
}
function setup(options: { pendingConnect?: boolean; failDisconnect?: boolean; failToken?: boolean; browserDefault?: boolean; failInitialConnection?: boolean; sharedPreview?: boolean; wrongDuration?: number } = {}) {
  const local = media(), output = media(), remote = new RemotePreview();
  let cameraRequests = 0, remoteConnections = 0;
  const camera = new LocalCamera(async () => cameraRequests++ === 0 ? local.stream : media().stream);
  camera.subscribe(() => { const stream = camera.getSnapshot(); if (stream) camera.markPlaying(stream); });
  remote.subscribe(() => { const stream = remote.getSnapshot(); if (stream) remote.markPlaying(stream); });
  const requests: Array<{ url: string; body: unknown }> = [], updates: unknown[] = [];
  const inputStreams: MediaStream[] = [];
  let disconnects = 0, connectOptions: RealTimeClientConnectOptions | null = null;
  let provider!: () => Promise<string>, finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  const client = { disconnect: () => { disconnects++; if (options.failDisconnect) throw new Error('test close failure'); }, set: async (input: unknown) => { updates.push(input); }, on: () => {} } as unknown as RealTimeClient;
  const request = (async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : null });
    if (String(url).endsWith('status')) return Response.json({ available: true, access: 'test-access', policy: STUDIO_POLICY });
    if (String(url).endsWith('token')) return options.failToken ? Response.json({ error: { message: '本轮已停止。' } }, { status: 503 }) : Response.json({ apiKey: 'ek_unit_test_only', durationSec: options.wrongDuration ?? JSON.parse(init?.body as string).durationSec, expiresAt: new Date(Date.now()+10000).toISOString() });
    return Response.json({ accepted: true });
  }) as typeof fetch;
  const factory: RealtimeSdkFactory = async (nextCredential) => {
    provider = nextCredential;
    return { model: { name: STUDIO_POLICY.model } as ModelDefinition, connect: async (_stream, args) => {
      inputStreams.push(_stream); connectOptions = args; await provider(); if (options.pendingConnect) await wait;
      if (options.failInitialConnection) {
        args.onConnectionChange?.('disconnected');
        throw { code: 'WEBRTC_WEBSOCKET_ERROR', message: 'unit-test-private-token-must-not-be-shown' };
      }
      args.onRemoteStream(remoteConnections++ === 0 ? output.stream : media().stream); return client;
    } };
  };
  const adapter = new DecartTryOnAdapter(camera, remote, options.browserDefault ? undefined : request, factory, { keepLocalPreview: options.sharedPreview }), controller = new SessionController(adapter, { durationMs: 15000 });
  controller.setGarment(garment); controller.setConsent(true);
  return { controller, adapter, camera, remote, local, output, requests, request, updates, finish, inputStreams, cameraRequests: () => cameraRequests, options: () => connectOptions, provider: () => provider(), disconnects: () => disconnects };
}

test('真实适配器只获取一个短期令牌，禁用重试和Fast，播放后才进入live', async () => {
  const s = setup();
  try {
    await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'live'); assert.equal(s.controller.getSnapshot().view, 'generated');
    assert.equal(s.options()?.retries, 0); assert.equal(s.options()?.capacityRetryBudgetMs, 0); assert.equal(s.options()?.speed, undefined);
    assert.equal(s.options()?.resolution, '720p'); assert.equal(s.options()?.initialState?.image, garment.blob);
    await assert.rejects(s.provider(), /unauthorized/);
    assert.equal(s.requests.filter((r) => r.url.endsWith('token')).length, 1);
    s.controller.stop(); assert.equal(s.local.track.readyState, 'ended'); assert.equal(s.output.track.readyState, 'ended'); assert.equal(s.disconnects(), 1);
    assert.equal(s.adapter.lastObservation?.localTracksEnded, true);
    assert.doesNotMatch(JSON.stringify(s.requests.filter((r) => r.url.endsWith('observation'))), /ek_unit_test_only|apiKey/);
  } finally { s.controller.reset(); }
});

test('连接中取消后迟到的SDK客户端和远端流都被关闭，不会复活', async () => {
  const s = setup({ pendingConnect: true }), running = s.controller.start();
  for (let i=0; i<10 && !s.options(); i++) await settle();
  assert.ok(s.options()); s.controller.stop(); s.finish(); await running;
  assert.equal(s.controller.getSnapshot().phase, 'ended'); assert.equal(s.local.track.stops, 1); assert.equal(s.output.track.stops, 1); assert.equal(s.disconnects(), 1); assert.equal(s.remote.getSnapshot(), null);
  s.controller.reset();
});

test('令牌签发失败后清理相机且不发起第二次请求', async () => {
  const s = setup({ failToken: true });
  await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'error'); assert.equal(s.camera.getSnapshot(), null);
  assert.equal(s.requests.filter((r) => r.url.endsWith('token')).length, 1); s.controller.reset();
});

test('更新服装发送完整状态；SDK关闭抛错也不会阻止本地资源清理', async () => {
  const s = setup({ failDisconnect: true });
  await s.controller.start(); s.controller.setGarment({ ...garment, id: 'second' }); await settle();
  assert.deepEqual(s.updates, [{ prompt: STUDIO_POLICY.prompt, image: garment.blob, enhance: false }]);
  s.controller.stop(); assert.equal(s.camera.getSnapshot(), null); assert.equal(s.remote.getSnapshot(), null); assert.equal(s.local.track.readyState, 'ended'); s.controller.reset();
});

test('缺少有效图片时不申请相机或签发令牌', async () => {
  const s = setup(); s.controller.setGarment({ id: 'sample', name: 'sample', previewUrl: '/assets/garments.svg' });
  await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'error'); assert.equal(s.requests.length, 0); assert.equal(s.camera.getSnapshot(), null); s.controller.reset();
});

test('浏览器原生fetch不能被绑定到适配器对象，默认请求仍能完成连接', async (t) => {
  let system!: ReturnType<typeof setup>;
  t.mock.method(globalThis, 'fetch', function(this: unknown, input: Parameters<typeof fetch>[0], init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return system.request(input, init);
  });
  system = setup({ browserDefault: true });
  try { await system.controller.start(); assert.equal(system.controller.getSnapshot().phase, 'live'); }
  finally { system.controller.reset(); }
});

test('首次disconnected不抢先覆盖SDK拒绝原因；只显示白名单类别并关闭相机', async () => {
  const s = setup({ failInitialConnection: true });
  try {
    await s.controller.start();
    const result = s.controller.getSnapshot();
    assert.equal(result.phase, 'error');
    assert.match(result.message ?? '', /WEBRTC_WEBSOCKET_ERROR/);
    assert.doesNotMatch(result.message ?? '', /unit-test-private-token/);
    assert.equal(s.local.track.readyState, 'ended');
    assert.equal(s.requests.filter((r) => r.url.endsWith('token')).length, 1);
    assert.equal(s.adapter.lastObservation?.outcome, 'error');
  } finally { s.controller.reset(); }
});

test('SDK诊断只返回固定类别，不回显错误正文、cause或任意code', () => {
  assert.equal(safeSdkDiagnostic(new Error('WebSocket closed: unit-test-private-token')), 'WEBRTC_WEBSOCKET_ERROR');
  assert.equal(safeSdkDiagnostic({ code: 'WEBRTC_ICE_ERROR', message: 'private' }), 'WEBRTC_ICE_ERROR');
  assert.equal(safeSdkDiagnostic(new Error('Connection timed out: private')), 'WEBRTC_TIMEOUT_ERROR');
  assert.equal(safeSdkDiagnostic({ code: 'private', message: 'private', cause: 'private' }), 'UNKNOWN');
});

test('主页面每次手动开启使用新操作号和云端告知，结束后可再开启且不复用令牌', async () => {
  const s = setup();
  try {
    await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'live');
    s.controller.stop(); await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'live');
    const tokens = s.requests.filter((r) => r.url === '/api/studio/token');
    assert.equal(tokens.length, 2);
    const bodies = tokens.map((r) => r.body as { attemptId: string; consentVersion: string });
    assert.notEqual(bodies[0].attemptId, bodies[1].attemptId);
    assert.equal(bodies[0].consentVersion, STUDIO_POLICY.consentVersion);
    assert.ok(s.requests.every((r) => r.url.startsWith('/api/studio/')));
  } finally { s.controller.reset(); }
});


test('共享预览时缺少已播放相机则拒绝，不主动申请相机或签发', async () => {
  const s = setup({ sharedPreview: true });
  await s.controller.start();
  assert.equal(s.controller.getSnapshot().phase, 'error'); assert.equal(s.cameraRequests(), 0); assert.equal(s.requests.length, 0);
  s.controller.reset();
});
test('已有相机被克隆接入，结束和重复换装不关闭或重启本地原画', async () => {
  const s = setup({ sharedPreview: true });
  await s.camera.start(new AbortController().signal, () => {});
  try {
    await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'live');
    assert.notEqual(s.inputStreams[0], s.local.stream);
    s.controller.stop();
    assert.equal(s.inputStreams[0].getTracks()[0].readyState, 'ended'); assert.equal(s.output.track.readyState, 'ended');
    assert.equal(s.local.track.readyState, 'live'); assert.equal(s.camera.isReady(), true);
    assert.equal(s.adapter.lastObservation?.localTracksEnded, false);
    await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'live');
    assert.equal(s.cameraRequests(), 1); assert.notEqual(s.inputStreams[0], s.inputStreams[1]);
    s.controller.reset(); assert.equal(s.local.track.readyState, 'live');
  } finally { s.controller.reset(); s.camera.stop(); }
});
test('云端签发失败仅回收克隆，本地相机仍能预览', async () => {
  const s = setup({ sharedPreview: true, failToken: true });
  await s.camera.start(new AbortController().signal, () => {});
  try {
    await s.controller.start(); assert.equal(s.controller.getSnapshot().phase, 'error');
    assert.equal(s.local.track.readyState, 'live'); assert.equal(s.camera.isReady(), true);
    assert.equal(s.inputStreams[0].getTracks()[0].readyState, 'ended');
    assert.equal(s.requests.filter((item) => item.url.endsWith('token')).length, 1);
  } finally { s.controller.reset(); s.camera.stop(); }
});
test('等待SDK时关闭原画会中止换装，迟到连接不会复活相机或远端流', async () => {
  const s = setup({ sharedPreview: true, pendingConnect: true });
  await s.camera.start(new AbortController().signal, () => {});
  const running = s.controller.start();
  for (let i = 0; i < 10 && !s.options(); i++) await settle();
  assert.ok(s.options()); s.camera.stop(); s.finish(); await running;
  assert.equal(s.controller.getSnapshot().phase, 'error'); assert.equal(s.camera.getSnapshot(), null);
  assert.equal(s.local.track.readyState, 'ended'); assert.equal(s.inputStreams[0].getTracks()[0].readyState, 'ended');
  assert.equal(s.output.track.readyState, 'ended'); assert.equal(s.remote.getSnapshot(), null);
  s.controller.reset();
});


test('三档时长随首次令牌请求发送，换图不重签', async () => {
  for (const duration of [15, 30, 60] as const) {
    const s = setup();
    try {
      s.controller.setDuration(duration); await s.controller.start();
      assert.equal(s.controller.getSnapshot().phase, 'live');
      const tokens = s.requests.filter((item) => item.url.endsWith('token'));
      assert.equal((tokens[0].body as { durationSec: number }).durationSec, duration);
      s.controller.setGarment({ ...garment, id: 'next' }); await settle();
      assert.equal(s.requests.filter((item) => item.url.endsWith('token')).length, 1);
    } finally { s.controller.reset(); }
  }
});

test('令牌响应的时长不一致时拒绝继续，不展示远端或再次签发', async () => {
  const s = setup({ wrongDuration: 15 });
  try {
    s.controller.setDuration(30); await s.controller.start();
    assert.equal(s.controller.getSnapshot().phase, 'error');
    assert.equal(s.remote.getSnapshot(), null);
    assert.equal(s.requests.filter((item) => item.url.endsWith('token')).length, 1);
  } finally { s.controller.reset(); }
});
