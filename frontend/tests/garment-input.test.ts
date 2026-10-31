import test from 'node:test';
import assert from 'node:assert/strict';
import { GarmentInput } from '../src/lib/images/garment-input';
import type { Garment } from '../src/lib/try-on/types';

function setup() {
  let garment: Garment | null = null, next = 0;
  const revoked: string[] = [], pending: Array<{ resolve: (blob: Blob) => void; reject: (error: Error) => void; signal: AbortSignal }> = [];
  const input = new GarmentInput((value) => { garment = value; }, {
    prepare: (_file: File, signal: AbortSignal) => new Promise<Blob>((resolve, reject) => { pending.push({ resolve, reject, signal }); }),
    createURL: () => `blob:${++next}`, revokeURL: (url) => { revoked.push(url); }, id: () => String(next),
  });
  return { input, revoked, pending, selected: () => garment };
}
const file = (name = '服装.png') => new File(['test'], name, { type: 'image/png' });

test('新图无效保留衣橱，追加不改变选择或释放仍在使用的URL', async () => {
  const s = setup();
  const first = s.input.upload(file()); s.pending[0].resolve(new Blob()); await first;
  const bad = s.input.upload(file('bad.png')); s.pending[1].reject(new Error('图片损坏')); await bad;
  assert.equal(s.selected()?.previewUrl, 'blob:1'); assert.deepEqual(s.revoked, []); assert.equal(s.input.getSnapshot().error, 'bad.png：图片损坏');
  const good = s.input.upload(file('new.png')); s.pending[2].resolve(new Blob()); await good;
  assert.equal(s.selected()?.previewUrl, 'blob:1'); assert.deepEqual(s.revoked, []);
  assert.equal(s.input.getSnapshot().garments.length, 2);
  s.input.select(s.input.getSnapshot().garments[1].id);
  assert.equal(s.selected()?.previewUrl, 'blob:2');
  s.input.dispose(); assert.deepEqual(s.revoked, ['blob:1', 'blob:2']);
});

test('快速上传只接受最新结果，旧处理结束不能清除新处理状态', async () => {
  const s = setup(), first = s.input.upload(file('old.png')), latest = s.input.upload(file('new.png'));
  assert.equal(s.pending[0].signal.aborted, true);
  s.pending[0].resolve(new Blob()); await first;
  assert.equal(s.input.getSnapshot().processing, true); assert.equal(s.selected(), null);
  s.pending[1].resolve(new Blob()); await latest;
  assert.equal(s.selected()?.name, 'new.png'); assert.equal(s.input.getSnapshot().processing, false); s.input.dispose();
});

test('取消处理、移除和卸载后迟到图片均不能恢复选择或创建URL', async () => {
  for (const action of ['cancel', 'clear', 'dispose'] as const) {
    const s = setup(), uploading = s.input.upload(file()); s.input[action]();
    s.pending[0].resolve(new Blob()); await uploading;
    assert.equal(s.selected(), null); assert.equal(s.input.getSnapshot().processing, false); assert.deepEqual(s.revoked, []);
  }
});

test('重复移除有效预览只释放一次URL', async () => {
  const s = setup(), first = s.input.upload(file()); s.pending[0].resolve(new Blob()); await first;
  s.input.clear(); s.input.clear(); s.input.dispose();
  assert.deepEqual(s.revoked, ['blob:1']); assert.equal(s.selected(), null);
});

function immediate() {
  let next = 0;
  const changes: Array<Garment | null> = [], revoked: string[] = [], decoded: string[] = [];
  const input = new GarmentInput((value) => changes.push(value), {
    prepare: async (item: File) => { decoded.push(item.name); if (item.name === 'bad.png') throw new Error('图片损坏'); return new Blob([item.name]); },
    createURL: () => `blob:${next}`, revokeURL: (url) => revoked.push(url), id: () => String(++next),
  });
  return { input, changes, revoked, decoded };
}

test('单图替换只保留新图并释放旧图，无效替换保留当前参考图', async () => {
  const s = immediate();
  await s.input.replace(file('a.png'));
  await s.input.replace(file('b.png'));
  assert.deepEqual(s.input.getSnapshot().garments.map(item => item.name), ['b.png']);
  assert.equal(s.changes.at(-1)?.name, 'b.png');
  assert.deepEqual(s.revoked, ['blob:1']);
  await s.input.replace(file('bad.png'));
  assert.deepEqual(s.input.getSnapshot().garments.map(item => item.name), ['b.png']);
  assert.equal(s.changes.at(-1)?.name, 'b.png');
  assert.deepEqual(s.revoked, ['blob:1']);
  s.input.dispose();
  assert.deepEqual(s.revoked, ['blob:1', 'blob:2']);
});

test('批量保留有效图并报告失败，默认首张，追加不切换，重复点选不触发更新', async () => {
  const s = immediate();
  await s.input.uploadMany([file('a.png'), file('bad.png'), file('b.png')]);
  assert.deepEqual(s.input.getSnapshot().garments.map((item) => item.name), ['a.png', 'b.png']);
  assert.equal(s.changes.length, 1); assert.equal(s.changes[0]?.name, 'a.png');
  assert.match(s.input.getSnapshot().error!, /bad.png.*图片损坏/);
  s.input.select('2'); s.input.select('2'); s.input.select('missing');
  await s.input.uploadMany([file('c.png')]);
  assert.equal(s.changes.length, 2); assert.equal(s.changes[1]?.name, 'b.png');
  assert.equal(s.input.getSnapshot().selectedId, '2'); s.input.dispose();
});

test('衣橱上限在解码前限制为6张，满额后导入不影响原图', async () => {
  const s = immediate();
  await s.input.uploadMany(Array.from({ length: 8 }, (_, index) => file(`${index}.png`)));
  assert.equal(s.input.getSnapshot().garments.length, 6); assert.equal(s.decoded.length, 6);
  assert.match(s.input.getSnapshot().error!, /最多保留6张/);
  await s.input.upload(file()); assert.equal(s.decoded.length, 6);
  assert.equal(s.changes.length, 1); s.input.dispose(); assert.equal(s.revoked.length, 6);
});

test('移除非选中图不更新，移除选中图切相邻图，最后一张才清空且URL各释放一次', async () => {
  const s = immediate(); await s.input.uploadMany([file('a.png'), file('b.png'), file('c.png')]);
  s.input.remove('2'); assert.equal(s.changes.length, 1);
  s.input.remove('1'); assert.equal(s.changes.at(-1)?.name, 'c.png');
  s.input.remove('3'); assert.equal(s.changes.at(-1), null);
  s.input.remove('3'); s.input.dispose();
  assert.deepEqual(s.revoked, ['blob:2', 'blob:1', 'blob:3']);
});

test('批量取消丢弃未发布批次，不创建URL或覆盖已有选择', async () => {
  const s = setup();
  const existing = s.input.upload(file('existing.png')); s.pending[0].resolve(new Blob()); await existing;
  const batch = s.input.uploadMany([file('a.png'), file('b.png')]);
  s.pending[1].resolve(new Blob()); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.pending.length, 3); s.input.cancel(); s.pending[2].resolve(new Blob()); await batch;
  assert.equal(s.input.getSnapshot().garments.length, 1);
  assert.equal(s.selected()?.name, 'existing.png'); assert.deepEqual(s.revoked, []);
  s.input.dispose(); assert.deepEqual(s.revoked, ['blob:1']);
});
