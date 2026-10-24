import test from 'node:test';
import assert from 'node:assert/strict';
import { GeneratedRecording, type RecordingPlatform } from '../src/lib/media/generated-recording';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
class Track extends EventTarget { readyState = 'live'; stops = 0; stop() { this.stops++; this.readyState = 'ended'; } }
function setup(options: { unsupported?: boolean; limit?: number; delayedPlay?: boolean } = {}) {
  const input = new Track(), audio = new Track(), captured = new Track();
  const source = { getVideoTracks: () => [input], getAudioTracks: () => [audio], getTracks: () => [input, audio] } as unknown as MediaStream;
  const output = { getVideoTracks: () => [captured], getAudioTracks: () => [], getTracks: () => [captured] } as unknown as MediaStream;
  let finishPlay!: () => void;
  const playing = new Promise<void>((resolve) => { finishPlay = resolve; });
  const video = { muted: false, playsInline: false, srcObject: null, videoWidth: 640, videoHeight: 360, play: () => options.delayedPlay ? playing : Promise.resolve(), pause() {} } as unknown as HTMLVideoElement;
  const context = { save() {}, restore() {}, translate() { assert.fail('缓存不得固化镜像，导出时才按界面设置处理'); }, scale() { assert.fail('缓存不得固化镜像'); }, drawImage() {} };
  const canvas = { width: 0, height: 0, getContext: () => context, captureStream: () => output } as unknown as HTMLCanvasElement;
  const revoked: string[] = [], blobs: Blob[] = [];
  const recorders: Array<{ state: string; mimeType: string; ondataavailable: ((event: { data: Blob }) => void) | null; onstop: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void }> = [];
  const platform: RecordingPlatform = {
    video: () => video, canvas: () => canvas, supported: (type) => !options.unsupported && type === 'video/webm',
    recorder: (stream) => {
      assert.equal(stream, output); assert.equal(stream.getAudioTracks().length, 0);
      const recorder = { state: 'inactive', mimeType: 'video/webm', ondataavailable: null as ((event: { data: Blob }) => void) | null, onstop: null as (() => void) | null, onerror: null as (() => void) | null,
        start() { this.state = 'recording'; }, stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['final-chunk']) }); this.onstop?.(); }); } };
      recorders.push(recorder); return recorder as unknown as MediaRecorder;
    },
    frame: () => 1, cancelFrame() {},
    url: (blob) => { blobs.push(blob); return `blob:recording-${blobs.length}`; }, revoke: (url) => { revoked.push(url); },
  };
  return { recorder: new GeneratedRecording(platform, options.limit), input, audio, captured, source, recorders, blobs, revoked, finishPlay, video };
}

test('没有主动start不创建录像；结束等待最后数据块，生成真实类型后缀且不停止源轨道', async () => {
  const s = setup();
  assert.equal(s.recorders.length, 0); assert.equal(s.recorder.getSnapshot().url, null);
  await s.recorder.start(s.source, 15);
  assert.equal(s.recorder.getSnapshot().phase, 'recording');
  s.recorder.stop(); assert.equal(s.recorder.getSnapshot().phase, 'stopping');
  await settle();
  assert.equal(s.recorder.getSnapshot().phase, 'ready');
  assert.equal(s.recorder.getSnapshot().extension, 'webm');
  assert.equal(await s.blobs[0].text(), 'final-chunk');
  assert.equal(s.blobs[0].type, 'video/webm');
  assert.equal(s.input.stops, 0); assert.equal(s.audio.stops, 0); assert.equal(s.captured.stops, 1);
  assert.equal(s.video.srcObject, null);
  s.recorder.clear(); assert.deepEqual(s.revoked, ['blob:recording-1']);
});

test('清除或卸载后，迟到的录制数据不能恢复下载链接', async () => {
  const s = setup(); await s.recorder.start(s.source, 30);
  s.recorder.stop(); s.recorder.clear(); await settle();
  assert.equal(s.recorder.getSnapshot().phase, 'idle'); assert.equal(s.blobs.length, 0);
  assert.equal(s.input.stops, 0); assert.equal(s.captured.stops, 1);
});

test('准备播放时取消，迟到play不能创建录制器或占用原流', async () => {
  const s = setup({ delayedPlay: true }); const running = s.recorder.start(s.source, 15);
  s.recorder.clear(); s.finishPlay(); await running;
  assert.equal(s.recorder.getSnapshot().phase, 'idle'); assert.equal(s.recorders.length, 0); assert.equal(s.input.stops, 0);
});

test('不支持录制或超出内存上限时明确失败，不伪造下载、不停止模型流', async () => {
  const unavailable = setup({ unsupported: true }); await unavailable.recorder.start(unavailable.source, 15);
  assert.equal(unavailable.recorder.getSnapshot().phase, 'error'); assert.equal(unavailable.recorders.length, 0);
  const s = setup({ limit: 2 }); await s.recorder.start(s.source, 60);
  s.recorders[0].ondataavailable?.({ data: new Blob(['too large']) }); await settle();
  assert.equal(s.recorder.getSnapshot().phase, 'error'); assert.equal(s.recorder.getSnapshot().url, null);
  assert.equal(s.blobs.length, 0); assert.equal(s.input.stops, 0); assert.equal(s.captured.stops, 1);
});

test('源视频自然结束时保留已录制片段；新一轮替换时释放旧文件', async () => {
  const s = setup(); await s.recorder.start(s.source, 15);
  s.input.dispatchEvent(new Event('ended')); await settle();
  assert.equal(s.recorder.getSnapshot().phase, 'ready');
  await s.recorder.start(s.source, 15);
  assert.deepEqual(s.revoked, ['blob:recording-1']);
  s.recorder.clear(); await settle(); assert.equal(s.recorder.getSnapshot().phase, 'idle');
});
