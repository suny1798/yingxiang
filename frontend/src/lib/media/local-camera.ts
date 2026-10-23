import { ExperienceError } from '../try-on/types';

export function cameraError(cause: unknown): ExperienceError {
  if (cause instanceof ExperienceError) return cause;
  const name = cause instanceof Error ? cause.name : '';
  const messages: Record<string, string> = {
    NotAllowedError: '尚未获得相机权限。请在浏览器的网站设置中允许相机，再手动重试。',
    SecurityError: '浏览器禁止访问相机。请检查网站权限，并使用本机地址或HTTPS。',
    NotFoundError: '没有找到可用相机。请连接摄像头后再试。',
    NotReadableError: '相机可能正被其他程序占用，或被系统隐私设置关闭。请检查后重试。',
    AbortError: '相机启动被中断，请检查设备后重试。',
    OverconstrainedError: '相机不支持当前画面设置，请更换设备后重试。',
  };
  return new ExperienceError('CAMERA_UNAVAILABLE', messages[name] ?? '相机无法开启，请检查设备与浏览器权限后重试。');
}

async function acquireCamera(): Promise<MediaStream> {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new ExperienceError('CAMERA_UNSUPPORTED', '当前环境无法访问相机。请用支持相机的浏览器打开本机地址或HTTPS页面。');
  }
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
}

/** 流只存在内存中；不能取消的系统授权返回后，仍按操作归属回收迟到流。 */
export class LocalCamera {
  private stream: MediaStream | null = null;
  private listeners = new Set<() => void>();
  private operation: object | null = null;
  private cleanup: (() => void) | null = null;
  private onFailure: ((error: Error) => void) | null = null;
  private ready: { stream: MediaStream; resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly acquire = acquireCamera, private readonly playbackTimeoutMs = 10_000) {}
  getSnapshot = (): MediaStream | null => this.stream;
  getServerSnapshot = (): null => null;
  isReady = (): boolean => this.stream !== null && this.ready === null && this.operation !== null && this.stream.getVideoTracks().every((track) => track.readyState === 'live');
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(stream: MediaStream | null) { this.stream = stream; this.listeners.forEach((listener) => listener()); }

  async start(signal: AbortSignal, onEnded: (error: Error) => void): Promise<void> {
    signal.throwIfAborted();
    this.stop();
    const operation = {}; this.operation = operation;
    const onAbort = () => { if (this.operation === operation) this.stop(); };
    signal.addEventListener('abort', onAbort, { once: true });
    let stream: MediaStream;
    try { stream = await this.acquire(); }
    catch (cause) {
      signal.removeEventListener('abort', onAbort);
      if (this.operation !== operation || signal.aborted) throw new DOMException('已取消', 'AbortError');
      this.operation = null;
      throw cameraError(cause);
    }
    if (signal.aborted || this.operation !== operation) {
      stream.getTracks().forEach((track) => track.stop());
      signal.removeEventListener('abort', onAbort);
      throw new DOMException('已取消', 'AbortError');
    }
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length || videoTracks.some((track) => track.readyState === 'ended') || stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      signal.removeEventListener('abort', onAbort); this.operation = null;
      throw new ExperienceError('CAMERA_INVALID', '未能取得有效的纯视频相机画面，请重试。');
    }
    const fail = (error: Error) => {
      if (this.operation !== operation) return;
      this.stop(); onEnded(error);
    };
    this.onFailure = fail;
    const ended = () => fail(new ExperienceError('CAMERA_ENDED', '相机已断开或权限已撤回，本次体验已结束。请检查后重新开启。'));
    videoTracks.forEach((track) => track.addEventListener('ended', ended));
    let timer: ReturnType<typeof setTimeout>;
    const playing = new Promise<void>((resolve, reject) => {
      this.ready = { stream, resolve: () => { clearTimeout(timer); resolve(); }, reject };
      timer = setTimeout(() => this.playbackFailed(stream, new ExperienceError('CAMERA_PLAY_TIMEOUT', '相机画面未能播放，请结束后重新开启，或更换浏览器。')), this.playbackTimeoutMs);
    });
    this.cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      videoTracks.forEach((track) => track.removeEventListener('ended', ended));
    };
    this.publish(stream);
    try { await playing; }
    catch (cause) { if (this.operation === operation) this.stop(); throw cause; }
  }

  markPlaying(stream: MediaStream): void {
    if (this.ready?.stream !== stream || this.stream !== stream) return;
    this.ready.resolve(); this.ready = null;
    // 授权取消与设备断开监听继续保留到整个体验结束。
  }

  playbackFailed(stream: MediaStream, error = new ExperienceError('CAMERA_PLAY_FAILED', '浏览器无法播放相机画面，请检查权限后重新开启。')): void {
    if (this.stream !== stream) return;
    if (this.ready?.stream === stream) { this.ready.reject(error); this.ready = null; }
    else this.onFailure?.(error);
  }

  stop(): void {
    this.operation = null;
    this.onFailure = null;
    this.cleanup?.(); this.cleanup = null;
    this.ready?.reject(new DOMException('已取消', 'AbortError')); this.ready = null;
    const stream = this.stream;
    if (stream) { stream.getTracks().forEach((track) => track.stop()); this.publish(null); }
  }
}
