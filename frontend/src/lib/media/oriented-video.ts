import type { RecordingPlatform } from './generated-recording';

export interface ExportedVideo { blob: Blob; extension: 'mp4' | 'webm' }
const platform: RecordingPlatform = {
  video: () => document.createElement('video'), canvas: () => document.createElement('canvas'),
  supported: (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  recorder: (stream, options) => new MediaRecorder(stream, options),
  frame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
  url: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url),
};

/** 输入始终为原方向文件。仅显式下载时，把页面镜像实际绘制进输出像素。 */
export async function orientVideo(blob: Blob, mirrored: boolean, signal: AbortSignal, progress: (percent?: number) => void, api = platform): Promise<ExportedVideo> {
  signal.throwIfAborted();
  if (!mirrored) return { blob, extension: blob.type.startsWith('video/webm') ? 'webm' : 'mp4' };
  const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find(api.supported);
  if (!mime) throw new Error('当前浏览器不支持按画面方向导出，请使用支持视频保存的浏览器。');
  const video = api.video(), url = api.url(blob);
  let output: MediaStream | null = null, recorder: MediaRecorder | null = null, frame: number | null = null;
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.loop = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
      const ready = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error('视频未能完整读取，请重新加载结果后再下载。')); };
      const aborted = () => { clean(); reject(new DOMException('已取消', 'AbortError')); };
      const timer = setTimeout(failed, 20_000);
      video.addEventListener('loadeddata', ready, { once: true }); video.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true }); video.src = url;
    });
    signal.throwIfAborted();
    const canvas = api.canvas(); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context || !canvas.width || !canvas.height || (Number.isFinite(video.duration) && video.duration > 61)) throw new Error('这段视频暂时无法按当前方向导出。');
    const draw = () => {
      context.save(); context.translate(canvas.width, 0); context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height); context.restore();
    };
    draw(); output = canvas.captureStream(25);
    recorder = api.recorder(output, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const activeRecorder = recorder;
    return await new Promise<ExportedVideo>((resolve, reject) => {
      const chunks: Blob[] = []; let bytes = 0, settled = false;
      const clean = () => { clearTimeout(timer); video.removeEventListener('ended', ended); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
      const fail = (error: Error) => { if (settled) return; settled = true; clean(); reject(error); };
      const failed = () => fail(new Error('视频导出未完成，请保持页面可见后重试。'));
      const aborted = () => fail(new DOMException('已取消', 'AbortError'));
      const ended = () => { try { draw(); activeRecorder.stop(); } catch { failed(); } };
      const timer = setTimeout(failed, 90_000);
      activeRecorder.ondataavailable = (event) => {
        if (settled || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 64 * 1024 * 1024) { fail(new Error('导出视频超过64MB，已停止处理。')); return; }
        chunks.push(event.data);
      };
      activeRecorder.onerror = failed;
      activeRecorder.onstop = () => {
        if (settled) return;
        if (!video.ended || !bytes) { failed(); return; }
        settled = true; clean();
        const type = activeRecorder.mimeType || mime;
        progress(100); resolve({ blob: new Blob(chunks, { type }), extension: type.startsWith('video/mp4') ? 'mp4' : 'webm' });
      };
      const tick = () => {
        if (settled || video.ended) return;
        try { draw(); progress(Number.isFinite(video.duration) && video.duration > 0 ? Math.min(99, video.currentTime / video.duration * 100) : undefined); frame = api.frame(tick); }
        catch { failed(); }
      };
      video.addEventListener('ended', ended, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
      try { activeRecorder.start(1000); void video.play().catch(failed); frame = api.frame(tick); }
      catch { failed(); }
    });
  } finally {
    if (frame !== null) api.cancelFrame(frame);
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* 继续回收本次导出资源。 */ } }
    output?.getTracks().forEach((track) => track.stop()); video.pause(); video.removeAttribute('src'); video.load(); api.revoke(url);
  }
}

/** 完整接收且限制内存；网络中断不把已收到的片段当成成功文件。 */
export async function readVideoBlob(url: string, signal: AbortSignal, progress: (percent?: number) => void): Promise<Blob> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('视频下载未完成，请稍后再试。');
  const maximum = 200 * 1024 * 1024, total = Number(response.headers.get('content-length'));
  const reader = response.body.getReader(); let size = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    if (total > maximum) throw new Error('视频超过200MB下载上限。');
    while (true) {
      const result = await reader.read(); signal.throwIfAborted();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) throw new Error('视频超过200MB下载上限。');
      chunks.push(new Uint8Array(result.value)); progress(total > 0 ? Math.min(99, size / total * 100) : undefined);
    }
    if (!size || (total > 0 && size !== total)) throw new Error('视频文件未下载完整，请稍后再试。');
    return new Blob(chunks, { type: response.headers.get('content-type')?.startsWith('video/webm') ? 'video/webm' : 'video/mp4' });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
