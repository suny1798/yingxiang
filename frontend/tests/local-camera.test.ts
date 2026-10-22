import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCamera, cameraError } from '../src/lib/media/local-camera';
import { LocalPreviewAdapter } from '../src/lib/try-on/local-preview-adapter';
import { SessionController } from '../src/lib/try-on/session-controller';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function media(audio = false) {
  class Track extends EventTarget {
    readyState = 'live'; stops = 0;
    stop() { this.stops++; this.readyState = 'ended'; }
  }
  const video = new Track(), mic = new Track();
  const stream = { getTracks: () => audio ? [video, mic] : [video], getVideoTracks: () => [video], getAudioTracks: () => audio ? [mic] : [] } as unknown as MediaStream;
  return { stream, video, mic };
}

test('相机仅在显式start时申请，实际播放前不就绪，停止后轨道关闭', async () => {
  const m = media(); let calls = 0, ready = false;
  const camera = new LocalCamera(async () => { calls++; return m.stream; });
  assert.equal(calls, 0);
  const running = camera.start(new AbortController().signal, () => {}).then(() => { ready = true; });
  await settle(); assert.equal(calls, 1); assert.equal(ready, false);
  assert.equal(camera.getSnapshot(), m.stream);
  camera.markPlaying(m.stream); await running; assert.equal(ready, true);
  camera.stop(); camera.stop(); assert.equal(m.video.stops, 1); assert.equal(camera.getSnapshot(), null);
});

test('等待系统授权时取消，迟到相机流直接停止且不会绑定', async () => {
  const m = media(), pending = deferred<MediaStream>(), abort = new AbortController();
  const camera = new LocalCamera(() => pending.promise);
  const running = camera.start(abort.signal, () => {});
  const rejected = assert.rejects(running, { name: 'AbortError' });
  abort.abort(); pending.resolve(m.stream); await rejected;
  assert.equal(m.video.stops, 1); assert.equal(camera.getSnapshot(), null);
});

test('旧授权返回不能停止或覆盖已开启的新相机', async () => {
  const old = media(), fresh = media(), pending = deferred<MediaStream>(); let calls = 0;
  const camera = new LocalCamera(() => ++calls === 1 ? pending.promise : Promise.resolve(fresh.stream));
  const first = camera.start(new AbortController().signal, () => {});
  const rejected = assert.rejects(first, { name: 'AbortError' });
  camera.stop(); const second = camera.start(new AbortController().signal, () => {});
  await settle(); camera.markPlaying(fresh.stream); await second;
  pending.resolve(old.stream); await rejected;
  assert.equal(old.video.stops, 1); assert.equal(fresh.video.stops, 0); assert.equal(camera.getSnapshot(), fresh.stream);
  camera.stop();
});

test('相机断开时清理流并通知会话；主动停止不会误报设备断开', async () => {
  const m = media(); let errors = 0;
  const camera = new LocalCamera(async () => m.stream);
  const running = camera.start(new AbortController().signal, () => { errors++; });
  await settle(); camera.markPlaying(m.stream); await running;
  m.video.dispatchEvent(new Event('ended'));
  assert.equal(errors, 1); assert.equal(m.video.stops, 1); assert.equal(camera.getSnapshot(), null);
  m.video.dispatchEvent(new Event('ended')); camera.stop(); assert.equal(errors, 1);
});

test('播放失败或超时会停止相机，旧播放器失败不能影响新流', async () => {
  const m = media(), camera = new LocalCamera(async () => m.stream, 15);
  await assert.rejects(camera.start(new AbortController().signal, () => {}), /未能播放/);
  assert.equal(m.video.stops, 1);
  const fresh = media(), next = new LocalCamera(async () => fresh.stream);
  const running = next.start(new AbortController().signal, () => {});
  const rejected = assert.rejects(running, /无法播放/);
  await settle(); next.playbackFailed(m.stream); assert.equal(fresh.video.stops, 0);
  next.playbackFailed(fresh.stream); await rejected; assert.equal(fresh.video.stops, 1);
});

test('意外包含音频的流被完整关闭', async () => {
  const m = media(true), camera = new LocalCamera(async () => m.stream);
  await assert.rejects(camera.start(new AbortController().signal, () => {}), /纯视频/);
  assert.equal(m.video.stops, 1); assert.equal(m.mic.stops, 1); assert.equal(camera.getSnapshot(), null);
});

test('播放就绪后取消信号仍关闭轨道并移除设备监听', async () => {
  const m = media(), abort = new AbortController(); let ended = 0;
  const camera = new LocalCamera(async () => m.stream);
  const running = camera.start(abort.signal, () => { ended++; });
  await settle(); camera.markPlaying(m.stream); await running;
  abort.abort(); m.video.dispatchEvent(new Event('ended'));
  assert.equal(m.video.stops, 1); assert.equal(camera.getSnapshot(), null); assert.equal(ended, 0);
});

test('播放中播放器报错会通知会话并停止流', async () => {
  const m = media(); let ended = 0;
  const camera = new LocalCamera(async () => m.stream);
  const running = camera.start(new AbortController().signal, () => { ended++; });
  await settle(); camera.markPlaying(m.stream); await running; camera.playbackFailed(m.stream);
  assert.equal(m.video.stops, 1); assert.equal(ended, 1); assert.equal(camera.getSnapshot(), null);
});

test('权限拒绝、无相机、占用和不支持设置有可恢复的中文提示', async () => {
  for (const [name, text] of [['NotAllowedError', /权限/], ['NotFoundError', /没有找到/], ['NotReadableError', /占用/], ['OverconstrainedError', /不支持/]] as const) {
    const camera = new LocalCamera(async () => { throw new DOMException('', name); });
    await assert.rejects(camera.start(new AbortController().signal, () => {}), text);
    assert.equal(camera.getSnapshot(), null);
  }
  assert.doesNotMatch(cameraError(new Error('sensitive internal diagnostic')).message, /sensitive/);
});

test('本地适配器重复开启只申请一次；取消确认同步关闭相机', async () => {
  const m = media(); let calls = 0;
  const camera = new LocalCamera(async () => { calls++; return m.stream; });
  const controller = new SessionController(new LocalPreviewAdapter(camera));
  controller.setGarment({ id: 'a', name: 'a', previewUrl: '/a' }); controller.setConsent(true);
  const running = controller.start(); await controller.start(); await settle();
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().phase, 'requestingCamera');
  controller.setConsent(false); await running;
  assert.equal(m.video.stops, 1); assert.equal(camera.getSnapshot(), null); assert.equal(controller.getSnapshot().phase, 'ended');
  controller.reset();
});

test('本地适配器在播放后设备中断时会话进入错误而非继续倒计时', async () => {
  const m = media(), camera = new LocalCamera(async () => m.stream);
  const controller = new SessionController(new LocalPreviewAdapter(camera));
  controller.setGarment({ id: 'a', name: 'a', previewUrl: '/a' }); controller.setConsent(true);
  const running = controller.start(); await settle(); camera.markPlaying(m.stream);
  m.video.dispatchEvent(new Event('ended')); await running;
  assert.equal(controller.getSnapshot().phase, 'error'); assert.match(controller.getSnapshot().message!, /断开/);
  assert.equal(camera.getSnapshot(), null); controller.reset();
});
