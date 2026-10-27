import type { RecordingSink } from '../works-upload';

export interface RecordingSnapshot {
  phase: 'idle' | 'preparing' | 'recording' | 'stopping' | 'ready' | 'error';
  url: string | null; extension: 'mp4' | 'webm' | null; bytes: number; message: string | null;
}
const idle: RecordingSnapshot = { phase: 'idle', url: null, extension: null, bytes: 0, message: null };
export interface RecordingPlatform {
  video(): HTMLVideoElement;
  canvas(): HTMLCanvasElement;
  supported(type: string): boolean;
  recorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder;
  frame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  url(blob: Blob): string;
  revoke(url: string): void;
}
const browser: RecordingPlatform = {
  video: () => document.createElement('video'), canvas: () => document.createElement('canvas'),
  supported: (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  recorder: (stream, options) => new MediaRecorder(stream, options),
  frame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
  url: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url),
};
interface Work {
  video: HTMLVideoElement; output: MediaStream | null; recorder: MediaRecorder | null;
  frame: number | null; timer: ReturnType<typeof setTimeout> | null;
  unwatch: () => void; chunks: Blob[]; bytes: number;
  sink?: RecordingSink; detached?: boolean;
}

/** 缓存无声生成画面；可把分片交给独立上传器。原画与源轨道不参与录制。 */
export class GeneratedRecording {
  private snapshot = idle;
  private listeners = new Set<() => void>();
  private work: Work | null = null;
  constructor(private readonly platform: RecordingPlatform = browser, private readonly maxBytes = 32 * 1024 * 1024) {}
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => idle;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: RecordingSnapshot) { this.snapshot = value; this.listeners.forEach((listener) => listener()); }
  async start(source: MediaStream, seconds: number, sink?: RecordingSink): Promise<void> {
    if (this.work?.sink) this.finishInBackground();
    this.clear();
    const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((type) => this.platform.supported(type));
    if (!mime) { this.publish({ ...idle, phase: 'error', message: '当前浏览器不支持本地视频保存，换装仍可正常使用。' }); return; }
    if (![15, 30, 60].includes(seconds) || !source.getVideoTracks().some((track) => track.readyState === 'live')) {
      this.publish({ ...idle, phase: 'error', message: '没有可保存的生成画面。' }); return;
    }
    const work: Work = { video: this.platform.video(), output: null, recorder: null, frame: null, timer: null, unwatch: () => {}, chunks: [], bytes: 0, sink };
    this.work = work;
    this.publish({ ...idle, phase: 'preparing' });
    sink?.start(mime);
    try {
      work.video.muted = true; work.video.playsInline = true; work.video.srcObject = source;
      await work.video.play();
      if (this.work !== work) { work.video.pause(); work.video.srcObject = null; return; }
      const canvas = this.platform.canvas();
      canvas.width = work.video.videoWidth; canvas.height = work.video.videoHeight;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context || !canvas.width || !canvas.height) throw new Error('video unavailable');
      const draw = () => {
        context.save();
        context.drawImage(work.video, 0, 0, canvas.width, canvas.height); context.restore();
      };
      draw(); work.output = canvas.captureStream(25);
      if (work.output.getAudioTracks().length) throw new Error('unexpected audio');
      const recorder = this.platform.recorder(work.output, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      work.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if ((this.work !== work && !work.detached) || !event.data.size) return;
        work.bytes += event.data.size;
        if (work.bytes > this.maxBytes) { this.fail(work, '本次视频超过32MB保存上限，已停止保存；换装不受影响。'); return; }
        work.chunks.push(event.data);
        work.sink?.chunk(event.data);
      };
      recorder.onerror = () => this.fail(work, '浏览器保存视频失败，换装不受影响。');
      recorder.onstop = () => {
        this.release(work);
        if (work.detached) { work.chunks = []; work.sink?.complete(); return; }
        if (this.work !== work) return;
        this.work = null;
        if (!work.bytes) { work.sink?.fail('本次未录到可保存的视频。'); this.publish({ ...idle, phase: 'error', message: '本次未录到可下载的视频。' }); return; }
        const actualType = recorder.mimeType || mime;
        try {
          const blob = new Blob(work.chunks, { type: actualType }); work.chunks = [];
          this.publish({ phase: 'ready', url: this.platform.url(blob), extension: actualType.startsWith('video/mp4') ? 'mp4' : 'webm', bytes: blob.size, message: null });
          work.sink?.complete();
        } catch { work.sink?.complete(); this.publish({ ...idle, phase: 'error', message: '本地回放未能准备，请到我的作品查看保存结果。' }); }
      };
      const frame = () => {
        if (this.work !== work || this.snapshot.phase !== 'recording') return;
        if (!source.getVideoTracks().some((track) => track.readyState === 'live')) { this.stop(); return; }
        try { draw(); work.frame = this.platform.frame(frame); }
        catch { this.fail(work, '生成画面已无法保存，换装不受影响。'); }
      };
      const ended = () => this.stop();
      source.getVideoTracks().forEach((track) => track.addEventListener('ended', ended));
      work.unwatch = () => source.getVideoTracks().forEach((track) => track.removeEventListener('ended', ended));
      recorder.start(1000); this.publish({ ...idle, phase: 'recording' });
      work.frame = this.platform.frame(frame);
      work.timer = setTimeout(() => this.stop(), seconds * 1000);
    } catch { this.fail(work, '当前浏览器无法保存这段视频，换装仍可正常使用。'); }
  }
  private release(work: Work) {
    if (work.frame !== null) this.platform.cancelFrame(work.frame); work.frame = null;
    if (work.timer) clearTimeout(work.timer); work.timer = null;
    work.unwatch(); work.video.pause(); work.video.srcObject = null;
    work.output?.getTracks().forEach((track) => track.stop()); work.output = null;
  }
  private fail(work: Work, message: string) {
    if (this.work !== work) return;
    this.work = null; work.chunks = [];
    try { if (work.recorder?.state !== 'inactive') work.recorder?.stop(); } catch { /* 仍回收自己的轨道。 */ }
    this.release(work); work.sink?.fail(message); this.publish({ ...idle, phase: 'error', message });
  }
  stop() {
    const work = this.work;
    if (!work || this.snapshot.phase === 'stopping') return;
    if (!work.recorder) { this.work = null; this.release(work); this.publish(idle); return; }
    this.publish({ ...this.snapshot, phase: 'stopping' });
    try { if (work.recorder.state !== 'inactive') work.recorder.stop(); }
    catch { this.fail(work, '视频未能完成保存。'); return; }
    this.release(work);
  }
  clear() {
    const work = this.work; this.work = null;
    if (work) {
      work.chunks = [];
      try { if (work.recorder?.state !== 'inactive') work.recorder?.stop(); } catch { /* 清除仍须继续。 */ }
      this.release(work);
    }
    if (this.snapshot.url) this.platform.revoke(this.snapshot.url);
    this.publish(idle);
  }
  /** 站内离开时结束录制，最后一个异步分片继续上传，不再产生页面下载URL。 */
  finishInBackground() {
    const work = this.work;
    if (!work) return;
    if (!work.sink) { this.clear(); return; }
    work.detached = true; this.work = null;
    try {
      if (work.recorder && work.recorder.state !== 'inactive') work.recorder.stop();
      else if (!work.recorder) work.sink.complete();
    } catch { work.sink.fail('录像收尾未完成，已保留上传的片段。'); }
    this.release(work);
  }
}
