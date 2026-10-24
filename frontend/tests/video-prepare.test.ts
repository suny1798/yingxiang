import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVideo, type PreparationProgress } from '../src/lib/video/prepare';

function fake() {
  const control = { url: '', method: '', body: null as unknown, status: 200, response: new Blob(['prepared'], { type: 'video/mp4' }),
    upload: {}, open(method: string, url: string) { this.method = method; this.url = url; }, setRequestHeader() {}, send(body: unknown) { this.body = body; },
    abort() { xhr.onabort?.call(xhr, {} as ProgressEvent); },
  };
  const xhr = control as unknown as XMLHttpRequest;
  return { xhr, control };
}

test('仅上传到本站，真实字节进度→不定处理进度→返回MP4，不调用生成接口', async () => {
  const s = fake(), progress: PreparationProgress[] = [];
  const file = new File(['input'], 'input.mp4', { type: 'video/mp4' });
  const running = prepareVideo(file, new AbortController().signal, (value) => progress.push(value), () => s.xhr);
  s.xhr.upload.onprogress?.call(s.xhr, { lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent<XMLHttpRequestEventTarget>);
  s.xhr.upload.onload?.call(s.xhr, {} as ProgressEvent<XMLHttpRequestEventTarget>);
  s.xhr.onload?.call(s.xhr, {} as ProgressEvent);
  assert.equal(await running, s.control.response);
  assert.equal(s.control.url, '/api/video/prepare'); assert.equal(s.control.body, file);
  assert.deepEqual(progress, [{ stage: 'upload', percent: 0 }, { stage: 'upload', percent: 50 }, { stage: 'processing' }]);
});

test('取消处理拒绝迟到结果；服务端错误信息可弹出而不暴露原始对象', async () => {
  const s = fake(), abort = new AbortController();
  const running = prepareVideo(new File(['input'], 'input.mp4'), abort.signal, () => {}, () => s.xhr);
  abort.abort(); await assert.rejects(running, { name: 'AbortError' });
  const failed = fake(); failed.control.status = 400; failed.control.response = new Blob([JSON.stringify({ error: { message: '视频结构无效。' } })], { type: 'application/json' });
  const request = prepareVideo(new File(['input'], 'input.mp4'), new AbortController().signal, () => {}, () => failed.xhr);
  failed.xhr.onload?.call(failed.xhr, {} as ProgressEvent);
  await assert.rejects(request, /视频结构无效/);
});
