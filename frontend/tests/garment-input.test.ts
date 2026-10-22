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
const file = (name = '上衣.png') => new File(['test'], name, { type: 'image/png' });

test('新图无效保留旧图，成功替换后才释放旧URL', async () => {
  const s = setup();
  const first = s.input.upload(file()); s.pending[0].resolve(new Blob()); await first;
  const bad = s.input.upload(file('bad.png')); s.pending[1].reject(new Error('图片损坏')); await bad;
  assert.equal(s.selected()?.previewUrl, 'blob:1'); assert.deepEqual(s.revoked, []); assert.equal(s.input.getSnapshot().error, '图片损坏');
  const good = s.input.upload(file('new.png')); s.pending[2].resolve(new Blob()); await good;
  assert.equal(s.selected()?.previewUrl, 'blob:2'); assert.deepEqual(s.revoked, ['blob:1']);
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

test('选择素材会取消上传并释放上传预览，重复移除不重复释放', async () => {
  const s = setup(), first = s.input.upload(file()); s.pending[0].resolve(new Blob()); await first;
  const next = s.input.upload(file('next.png')); s.input.sample('knit'); s.pending[1].resolve(new Blob()); await next;
  assert.equal(s.selected()?.sampleId, 'knit'); assert.deepEqual(s.revoked, ['blob:1']);
  s.input.clear(); s.input.clear(); s.input.dispose(); assert.deepEqual(s.revoked, ['blob:1']); assert.equal(s.selected(), null);
});
