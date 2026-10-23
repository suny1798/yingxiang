import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/lib/try-on/session-controller';
import type { ConnectOptions, Garment, TryOnAdapter } from '../src/lib/try-on/types';
import { GarmentInput } from '../src/lib/images/garment-input';

const garment = (id: string): Garment => ({ id, name: id, previewUrl: `/sample/${id}` });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

class ControlledAdapter implements TryOnAdapter {
  readonly mode = 'real' as const;
  connections: Array<{ options: ConnectOptions; wait: ReturnType<typeof deferred> }> = [];
  updates: Array<{ garment: Garment; wait: ReturnType<typeof deferred> }> = [];
  connect(options: ConnectOptions) { const wait = deferred(); this.connections.push({ options, wait }); options.onPhase('connecting'); return wait.promise; }
  updateGarment(value: Garment) { const wait = deferred(); this.updates.push({ garment: value, wait }); return wait.promise; }
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

test('换图不延长截止时间，超时后在途更新不会复活', async () => {
  let now = 1000;
  const adapter = new ControlledAdapter(), controller = new SessionController(adapter, { durationMs: 1000, now: () => now });
  try {
    controller.setGarment(garment('initial')); controller.setConsent(true);
    const running = controller.start(); adapter.connections[0].wait.resolve(); await running;
    const deadline = controller.getSnapshot().deadlineAt;
    now = 1500; controller.setGarment(garment('next')); assert.equal(controller.getSnapshot().deadlineAt, deadline);
    now = 2000; controller.tick(); adapter.updates[0].wait.resolve(); await settle();
    assert.equal(controller.getSnapshot().phase, 'ended');
  } finally { controller.reset(); }
});

test('重置在途操作后保持初始状态', async () => {
  const { adapter, controller } = setup();
  const running = controller.start(); controller.reset(); adapter.connections[0].wait.resolve(); await running;
  assert.equal(controller.getSnapshot().phase, 'idle'); assert.equal(controller.getSnapshot().garment, null); assert.equal(controller.getSnapshot().consent, false);
});

test('衣橱点选三张图复用单连接和期限，删除最后一张才结束', async () => {
  const adapter = new ControlledAdapter(), controller = new SessionController(adapter);
  let next = 0;
  const input = new GarmentInput((value) => controller.setGarment(value), {
    prepare: async () => new Blob(['reference']), createURL: () => `blob:${next}`,
    revokeURL: () => {}, id: () => String(++next),
  });
  try {
    await input.uploadMany(['a', 'b', 'c'].map((name) => new File(['test'], `${name}.png`, { type: 'image/png' })));
    controller.setConsent(true);
    const running = controller.start(); adapter.connections[0].wait.resolve(); await running;
    const deadline = controller.getSnapshot().deadlineAt;
    input.select('2'); adapter.updates[0].wait.resolve(); await settle();
    input.select('3'); adapter.updates[1].wait.resolve(); await settle();
    assert.deepEqual(adapter.updates.map((item) => item.garment.name), ['b.png', 'c.png']);
    assert.equal(adapter.connections.length, 1); assert.equal(controller.getSnapshot().deadlineAt, deadline);
    input.remove('1'); input.remove('2'); assert.equal(controller.getSnapshot().phase, 'live');
    input.remove('3'); assert.equal(controller.getSnapshot().phase, 'idle');
    assert.equal(adapter.connections[0].options.signal.aborted, true);
  } finally { controller.reset(); input.dispose(); }
});


test('三档从connecting开始截止，活动中不可改档，换衣不续时，结束后可另选', async () => {
  for (const seconds of [15, 30, 60] as const) {
    let now = 1000;
    const adapter = new ControlledAdapter(), controller = new SessionController(adapter, { now: () => now });
    try {
      controller.setGarment(garment('first')); controller.setConsent(true); controller.setDuration(seconds);
      const running = controller.start();
      assert.equal(controller.getSnapshot().deadlineAt, 1000 + seconds * 1000);
      assert.equal(adapter.connections[0].options.durationSec, seconds);
      controller.setDuration(seconds === 15 ? 60 : 15);
      assert.equal(controller.getSnapshot().durationSec, seconds);
      now += 4000; adapter.connections[0].wait.resolve(); await running;
      assert.equal(controller.getSnapshot().remainingSeconds, seconds - 4);
      const deadline = controller.getSnapshot().deadlineAt;
      controller.setGarment(garment('next')); assert.equal(controller.getSnapshot().deadlineAt, deadline);
      now = deadline!; controller.tick(); adapter.updates[0].wait.resolve(); await settle();
      assert.equal(controller.getSnapshot().phase, 'ended');
      controller.setDuration(30); assert.equal(controller.getSnapshot().remainingSeconds, 30);
      controller.setDuration(120 as never); assert.equal(controller.getSnapshot().durationSec, 30);
    } finally { controller.reset(); }
  }
});
