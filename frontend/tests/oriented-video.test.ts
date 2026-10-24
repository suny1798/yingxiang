import test from 'node:test';
import assert from 'node:assert/strict';
import { orientVideo, readVideoBlob } from '../src/lib/media/oriented-video';
import type { RecordingPlatform } from '../src/lib/media/generated-recording';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  class Video extends EventTarget {
    muted = false; playsInline = false; preload = ''; loop = false; videoWidth = 640; videoHeight = 360;
    duration = 2; currentTime = 0; ended = false; stopped = false;
    set src(_value: string) { queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
    play() { return Promise.resolve(); } pause() { this.stopped = true; } removeAttribute() {} load() {}
  }
  const video = new Video(), scales: number[][] = [], revoked: string[] = [], progress: Array<number | undefined> = [];
  let stops = 0, draws = 0, tick: FrameRequestCallback | null = null;
  const context = { save() {}, restore() {}, translate() {}, scale(x: number, y: number) { scales.push([x, y]); }, drawImage() { draws++; } };
  const output = { getTracks: () => [{ stop() { stops++; } }] } as unknown as MediaStream;
  const recorder = { state: 'inactive', mimeType: 'video/webm', onstop: null as (() => void) | null, onerror: null as (() => void) | null, ondataavailable: null as ((event: { data: Blob }) => void) | null,
    start() { this.state = 'recording'; }, stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['last-frame']) }); this.onstop?.(); }); } };
  const api: RecordingPlatform = {
    video: () => video as unknown as HTMLVideoElement,
    canvas: () => ({ width: 0, height: 0, getContext: () => context, captureStream: () => output }) as unknown as HTMLCanvasElement,
    supported: (type) => type === 'video/webm', recorder: () => recorder as unknown as MediaRecorder,
    frame: (callback) => { tick = callback; return 1; }, cancelFrame() {}, url: () => 'blob:source', revoke: (value) => revoked.push(value),
  };
  return { video, api, scales, revoked, progress, recorder, tick: () => tick?.(0), get stops() { return stops; }, get draws() { return draws; } };
}

test('关闭镜像直接使用原文件，不解码、不重复翻转，真实容器后缀保持一致', async () => {
  const s = fixture(), blob = new Blob(['original'], { type: 'video/webm' });
  const output = await orientVideo(blob, false, new AbortController().signal, () => {}, s.api);
  assert.equal(output.blob, blob); assert.equal(output.extension, 'webm'); assert.equal(s.draws, 0);
});

test('镜像绘制到每帧像素，结束后收齐最后数据块，回收导出轨道与源URL', async () => {
  const s = fixture();
  const pending = orientVideo(new Blob(['source']), true, new AbortController().signal, (value) => s.progress.push(value), s.api);
  await settle(); s.video.currentTime = 1; s.tick();
  assert.deepEqual(s.progress, [50]);
  s.video.currentTime = 2; s.video.ended = true; s.video.dispatchEvent(new Event('ended'));
  const result = await pending;
  assert.equal(await result.blob.text(), 'last-frame'); assert.equal(result.extension, 'webm');
  assert.ok(s.scales.length >= 3); assert.ok(s.scales.every(([x, y]) => x === -1 && y === 1));
  assert.equal(s.progress.at(-1), 100); assert.deepEqual(s.revoked, ['blob:source']); assert.equal(s.stops, 1); assert.equal(s.video.stopped, true);
});

test('导出取消后迟到结束不能返回部分文件，轨道及内存资源仍回收', async () => {
  const s = fixture(), controller = new AbortController();
  const pending = orientVideo(new Blob(['source']), true, controller.signal, () => {}, s.api);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await settle(); controller.abort(); await rejected;
  s.video.ended = true; s.video.dispatchEvent(new Event('ended')); await settle();
  assert.equal(s.stops, 1); assert.deepEqual(s.revoked, ['blob:source']);
});

test('已取消操作不创建资源，不支持导出也不回退到错误方向文件', async () => {
  const s = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(orientVideo(new Blob(), true, controller.signal, () => {}, s.api), { name: 'AbortError' });
  await assert.rejects(orientVideo(new Blob(), true, new AbortController().signal, () => {}, { ...s.api, supported: () => false }), /不支持/);
  assert.deepEqual(s.revoked, []); assert.equal(s.draws, 0);
});

test('接收完整文件才返回；短响应或断流不能伪装成成功下载', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('ok', { headers: { 'content-length': '2', 'content-type': 'video/mp4' } });
    assert.equal((await readVideoBlob('/synthetic', new AbortController().signal, () => {})).size, 2);
    globalThis.fetch = async () => new Response('short', { headers: { 'content-length': '20' } });
    await assert.rejects(readVideoBlob('/synthetic', new AbortController().signal, () => {}), /未下载完整/);
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('synthetic disconnect')); } }));
    await assert.rejects(readVideoBlob('/synthetic', new AbortController().signal, () => {}), /synthetic disconnect/);
  } finally { globalThis.fetch = originalFetch; }
});
