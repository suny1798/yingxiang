import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/lib/try-on/session-controller';
import { MockTryOnAdapter } from '../src/lib/try-on/mock-adapter';
import type { ConnectOptions, Garment, TryOnAdapter } from '../src/lib/try-on/types';

const garment = (id: string): Garment => ({ id, name: id, previewUrl: `/sample/${id}` });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

class ControlledAdapter implements TryOnAdapter {
  readonly mode = 'mock' as const;
  connections: Array<{ options: ConnectOptions; wait: ReturnType<typeof deferred> }> = [];
  updates: Array<{ garment: Garment; wait: ReturnType<typeof deferred> }> = [];
  recover = deferred();
  connect(options: ConnectOptions) { const wait = deferred(); this.connections.push({ options, wait }); options.onPhase('connecting'); return wait.promise; }
  updateGarment(value: Garment) { const wait = deferred(); this.updates.push({ garment: value, wait }); return wait.promise; }
  reconnect() { return this.recover.promise; }
  stop() {}
}

function setup() {
  const adapter = new ControlledAdapter();
  const controller = new SessionController(adapter);
  controller.setGarment(garment('initial')); controller.setConsent(true);
  return { adapter, controller };
}

test('没有参考图或处理确认时不能启动', async () => {
  const adapter = new ControlledAdapter(), controller = new SessionController(adapter);
  await controller.start(); controller.setGarment(garment('a')); await controller.start();
  assert.equal(adapter.connections.length, 0); controller.reset();
});

test('重复开启只创建一次连接，取消后迟到结果不能恢复体验', async () => {
  const { adapter, controller } = setup();
  try {
    const first = controller.start(); await controller.start();
    assert.equal(adapter.connections.length, 1);
    controller.stop(); adapter.connections[0].wait.resolve(); await first;
    assert.equal(controller.getSnapshot().phase, 'ended');
    assert.equal(adapter.connections[0].options.signal.aborted, true);
  } finally { controller.reset(); }
});

test('旧连接完成不能覆盖重新开启的连接', async () => {
  const { adapter, controller } = setup();
  try {
    const old = controller.start(); controller.stop(); const fresh = controller.start();
    adapter.connections[0].wait.resolve(); await old;
    assert.equal(controller.getSnapshot().phase, 'connecting');
    adapter.connections[1].wait.resolve(); await fresh;
    assert.equal(controller.getSnapshot().phase, 'live');
  } finally { controller.reset(); }
});

test('取消处理确认会结束体验且旧异步结果无法继续', async () => {
  const { adapter, controller } = setup();
  try {
    const running = controller.start(); controller.setConsent(false);
    adapter.connections[0].wait.resolve(); await running;
    assert.equal(controller.getSnapshot().phase, 'ended'); assert.equal(controller.getSnapshot().consent, false);
  } finally { controller.reset(); }
});

test('快速换图串行提交，等待队列合并为最新选择', async () => {
  const { adapter, controller } = setup();
  try {
    const running = controller.start(); adapter.connections[0].wait.resolve(); await running;
    controller.setGarment(garment('a')); controller.setGarment(garment('b')); controller.setGarment(garment('c'));
    assert.deepEqual(adapter.updates.map((item) => item.garment.id), ['a']);
    adapter.updates[0].wait.resolve(); await settle();
    assert.deepEqual(adapter.updates.map((item) => item.garment.id), ['a', 'c']);
    adapter.updates[1].wait.resolve(); await settle();
    assert.equal(controller.getSnapshot().garment?.id, 'c'); assert.equal(controller.getSnapshot().phase, 'live');
  } finally { controller.reset(); }
});

test('建连中更换的图片在连接完成后应用', async () => {
  const { adapter, controller } = setup();
  try {
    const running = controller.start(); controller.setGarment(garment('latest'));
    adapter.connections[0].wait.resolve(); await running;
    assert.deepEqual(adapter.updates.map((item) => item.garment.id), ['latest']);
    adapter.updates[0].wait.resolve(); await settle();
    assert.equal(controller.getSnapshot().phase, 'live');
  } finally { controller.reset(); }
});

test('换图期间结束，不会被更新完成事件重新激活', async () => {
  const { adapter, controller } = setup();
  try {
    const running = controller.start(); adapter.connections[0].wait.resolve(); await running;
    controller.setGarment(garment('next')); controller.stop(); adapter.updates[0].wait.resolve(); await settle();
    assert.equal(controller.getSnapshot().phase, 'ended');
  } finally { controller.reset(); }
});

test('重连沿用原截止时间，超时后晚到的重连不会复活', async () => {
  let now = 1000;
  const adapter = new ControlledAdapter(), controller = new SessionController(adapter, { durationMs: 1000, now: () => now });
  try {
    controller.setGarment(garment('initial')); controller.setConsent(true);
    const running = controller.start(); adapter.connections[0].wait.resolve(); await running;
    const deadline = controller.getSnapshot().deadlineAt;
    now = 1500; const reconnecting = controller.reconnect(); assert.equal(controller.getSnapshot().deadlineAt, deadline);
    now = 2000; controller.tick(); adapter.recover.resolve(); await reconnecting;
    assert.equal(controller.getSnapshot().phase, 'ended');
  } finally { controller.reset(); }
});

test('重置在途操作后保持初始状态', async () => {
  const { adapter, controller } = setup();
  const running = controller.start(); controller.reset(); adapter.connections[0].wait.resolve(); await running;
  assert.equal(controller.getSnapshot().phase, 'idle'); assert.equal(controller.getSnapshot().garment, null); assert.equal(controller.getSnapshot().consent, false);
});

for (const scenario of ['camera-denied', 'capacity', 'quota', 'connection-error'] as const) {
  test(`Mock错误 ${scenario} 可恢复且不会留下活动会话`, async () => {
    const controller = new SessionController(new MockTryOnAdapter(0));
    try {
      controller.setGarment(garment('a')); controller.setConsent(true); controller.setScenario(scenario); await controller.start();
      assert.equal(controller.getSnapshot().phase, 'error'); assert.ok(controller.getSnapshot().message);
      controller.setScenario('normal'); await controller.start(); assert.equal(controller.getSnapshot().phase, 'live');
    } finally { controller.reset(); }
  });
}
