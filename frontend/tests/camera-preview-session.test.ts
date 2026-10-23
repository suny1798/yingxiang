import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCamera } from '../src/lib/media/local-camera';
import { CameraPreviewSession } from '../src/lib/media/camera-preview-session';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function media() {
  class Track extends EventTarget { readyState = 'live'; stops = 0; stop() { this.stops++; this.readyState = 'ended'; } }
  const track = new Track();
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream };
}
test('本地预览不需要图片/账号，显式开启后才请求相机，重复开启不重建', async () => {
  const m = media(); let requests = 0;
  const camera = new LocalCamera(async () => { requests++; return m.stream; }), preview = new CameraPreviewSession(camera);
  assert.equal(preview.getSnapshot().phase, 'off'); assert.equal(requests, 0);
  const running = preview.start(); await preview.start(); await settle();
  assert.equal(requests, 1); assert.equal(preview.getSnapshot().phase, 'requesting'); assert.equal(camera.isReady(), false);
  camera.markPlaying(m.stream); await running;
  assert.equal(preview.getSnapshot().phase, 'ready'); assert.equal(camera.isReady(), true);
  preview.stop(); assert.equal(m.track.readyState, 'ended'); assert.equal(preview.getSnapshot().phase, 'off');
});
test('取消授权等待后重新打开，旧流迟到不会覆盖新预览', async () => {
  const old = media(), fresh = media(); let finish!: (stream: MediaStream) => void, requests = 0;
  const pending = new Promise<MediaStream>((resolve) => { finish = resolve; });
  const camera = new LocalCamera(() => ++requests === 1 ? pending : Promise.resolve(fresh.stream)), preview = new CameraPreviewSession(camera);
  const first = preview.start(); preview.stop();
  const second = preview.start(); await settle(); camera.markPlaying(fresh.stream); await second;
  finish(old.stream); await first;
  assert.equal(old.track.stops, 1); assert.equal(fresh.track.stops, 0); assert.equal(preview.getSnapshot().phase, 'ready');
  preview.stop();
});
test('权限失败可手动恢复，设备断开会关闭原画并回传错误', async () => {
  const m = media(); let requests = 0;
  const camera = new LocalCamera(async () => { if (++requests === 1) throw new DOMException('denied', 'NotAllowedError'); return m.stream; });
  const preview = new CameraPreviewSession(camera);
  await preview.start(); assert.equal(preview.getSnapshot().phase, 'error'); assert.match(preview.getSnapshot().message!, /权限/);
  const running = preview.start(); await settle(); camera.markPlaying(m.stream); await running;
  m.track.dispatchEvent(new Event('ended'));
  assert.equal(preview.getSnapshot().phase, 'error'); assert.equal(camera.getSnapshot(), null); assert.equal(camera.isReady(), false);
  preview.stop(); assert.equal(preview.getSnapshot().phase, 'off');
});
test('停止本地预览幂等，播放超时后不会误报就绪', async () => {
  const m = media(), camera = new LocalCamera(async () => m.stream, 15), preview = new CameraPreviewSession(camera);
  await preview.start(); assert.equal(preview.getSnapshot().phase, 'error'); assert.equal(m.track.stops, 1);
  camera.markPlaying(m.stream); assert.equal(camera.isReady(), false);
  preview.stop(); preview.stop(); assert.equal(m.track.stops, 1);
});
