import test from 'node:test';
import assert from 'node:assert/strict';
import { NoticeStore } from '../src/lib/notices';

test('同一错误去重，关闭后再次操作仍能重新提示', () => {
  const store = new NoticeStore();
  const first = store.show({ kind: 'error', message: '视频格式无效。' });
  assert.equal(store.show({ kind: 'error', message: '视频格式无效。' }), first);
  assert.equal(store.getSnapshot().length, 1);
  store.dismiss(first);
  assert.notEqual(store.show({ kind: 'error', message: '视频格式无效。' }), first);
  store.getSnapshot().forEach((item) => store.dismiss(item.id));
});

test('进度更新替换原通知，未知处理进度不编造百分比', () => {
  const store = new NoticeStore();
  const id = store.show({ kind: 'progress', message: '上传中', progress: 50 });
  store.show({ id, kind: 'progress', message: '移除音轨中' });
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].progress, undefined);
  assert.equal(store.getSnapshot()[0].message, '移除音轨中');
  store.dismiss(id); assert.equal(store.getSnapshot().length, 0);
});

test('通知最多三条，删除一条不会清除其他操作错误', () => {
  const store = new NoticeStore();
  for (let index = 0; index < 4; index++) store.show({ kind: 'error', message: String(index) });
  assert.deepEqual(store.getSnapshot().map((item) => item.message), ['1', '2', '3']);
  store.dismiss(store.getSnapshot()[1].id);
  assert.deepEqual(store.getSnapshot().map((item) => item.message), ['1', '3']);
  store.getSnapshot().forEach((item) => store.dismiss(item.id));
});

test('完成型通知自动消失，处理进度保留，更新会重置倒计时', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new NoticeStore();
  const success = store.show({ kind: 'success', message: '已添加服装图' });
  store.show({ kind: 'error', message: '连接未完成' });
  const progress = store.show({ kind: 'progress', message: '处理中' });
  context.mock.timers.tick(4000);
  store.show({ id: success, kind: 'info', message: '更新提示' });
  context.mock.timers.tick(500);
  assert.equal(store.getSnapshot().length, 3);
  context.mock.timers.tick(2500);
  assert.deepEqual(store.getSnapshot().map((item) => item.kind), ['progress', 'info']);
  context.mock.timers.tick(1500);
  assert.deepEqual(store.getSnapshot().map((item) => item.id), [progress]);
  store.show({ id: progress, kind: 'success', message: '处理完成' });
  context.mock.timers.tick(4500);
  assert.equal(store.getSnapshot().length, 0);
});
