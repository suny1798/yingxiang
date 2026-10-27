import test from 'node:test';
import assert from 'node:assert/strict';
import { canCaptureVideoFrame, captureVideoFrame, downloadVideoFrame, safeFrameFilename, type VideoFramePlatform } from '../src/lib/media/video-frame';

function fixture() {
  const calls: string[] = [], transforms: number[][] = [];
  const context = {
    save() { calls.push('save'); }, restore() { calls.push('restore'); },
    translate(x: number, y: number) { calls.push(`translate:${x},${y}`); },
    scale(x: number, y: number) { transforms.push([x, y]); },
    drawImage() { calls.push('draw'); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void, type: string) => { calls.push(type); callback(new Blob(['png'], { type })); },
  } as unknown as HTMLCanvasElement;
  const video = { readyState: 4, videoWidth: 640, videoHeight: 360 } as HTMLVideoElement;
  const platform: VideoFramePlatform = {
    canvas: () => canvas,
    objectURL: () => { calls.push('url'); return 'blob:frame'; },
    revokeURL: (url) => calls.push(`revoke:${url}`),
    download: (_url, filename) => calls.push(`download:${filename}`),
    defer: (callback) => { calls.push('defer'); callback(); },
  };
  return { canvas, video, platform, calls, transforms, context };
}

test('只有已有尺寸且可解码当前帧的视频允许截图', () => {
  assert.equal(canCaptureVideoFrame(null), false);
  assert.equal(canCaptureVideoFrame({ readyState: 1, videoWidth: 640, videoHeight: 360 } as HTMLVideoElement), false);
  assert.equal(canCaptureVideoFrame({ readyState: 4, videoWidth: 0, videoHeight: 360 } as HTMLVideoElement), false);
  assert.equal(canCaptureVideoFrame({ readyState: 2, videoWidth: 640, videoHeight: 360 } as HTMLVideoElement), true);
});

test('截图保留源尺寸与PNG类型，镜像时实际翻转坐标且恢复画布状态', async () => {
  const s = fixture();
  const plain = await captureVideoFrame(s.video, false, s.platform);
  assert.equal(plain.type, 'image/png');
  assert.deepEqual([s.canvas.width, s.canvas.height], [640, 360]);
  assert.deepEqual(s.calls, ['draw', 'image/png']);
  s.calls.length = 0;
  await captureVideoFrame(s.video, true, s.platform);
  assert.deepEqual(s.transforms, [[-1, 1]]);
  assert.deepEqual(s.calls, ['save', 'translate:640,0', 'draw', 'restore', 'image/png']);
});

test('未就绪、绘制失败及空编码结果都有明确错误，不返回空白图片', async () => {
  const s = fixture();
  await assert.rejects(captureVideoFrame(null, false, s.platform), /尚未就绪/);
  s.context.drawImage = () => { throw new DOMException('tainted', 'SecurityError'); };
  await assert.rejects(captureVideoFrame(s.video, false, s.platform), /暂时无法截图/);
  s.context.drawImage = () => {};
  s.canvas.toBlob = ((callback: (blob: Blob | null) => void) => callback(null)) as HTMLCanvasElement['toBlob'];
  await assert.rejects(captureVideoFrame(s.video, false, s.platform), /有效图片/);
});

test('下载文件名过滤非法字符，对象URL在下载调用后释放', () => {
  const s = fixture();
  assert.equal(safeFrameFilename('  春日/穿搭:*?  '), '春日 穿搭.png');
  assert.equal(safeFrameFilename(''), '映想-当前帧.png');
  downloadVideoFrame(new Blob(['png'], { type: 'image/png' }), '我的/作品', s.platform);
  assert.deepEqual(s.calls, ['url', 'download:我的 作品.png', 'defer', 'revoke:blob:frame']);
});
