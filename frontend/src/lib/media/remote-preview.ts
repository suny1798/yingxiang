/** 远端视频的呈现就绪与所有权，不录制、不持久化媒体。 */
export class RemotePreview {
  private stream: MediaStream | null = null;
  private listeners = new Set<() => void>();
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private cleanup: (() => void) | null = null;
  private signal: AbortSignal | null = null;
  private failure: ((error: Error) => void) | null = null;
  private startedAt = 0;
  firstFrameMs: number | null = null;
  getSnapshot = () => this.stream;
  getServerSnapshot = () => null;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(stream: MediaStream | null) { this.stream = stream; this.listeners.forEach((listener) => listener()); }
  prepare(signal: AbortSignal, onFailure: (error: Error) => void): Promise<void> {
    this.stop(); signal.throwIfAborted(); this.signal = signal; this.failure = onFailure;
    this.startedAt = performance.now(); this.firstFrameMs = null;
    const onAbort = () => this.stop();
    signal.addEventListener('abort', onAbort, { once: true });
    this.cleanup = () => signal.removeEventListener('abort', onAbort);
    return new Promise((resolve, reject) => { this.ready = { resolve, reject }; });
  }
  offer(stream: MediaStream) {
    if (this.signal?.aborted !== false) { stream.getTracks().forEach((track) => track.stop()); return; }
    if (this.stream && this.stream !== stream) this.stream.getTracks().forEach((track) => track.stop());
    this.publish(stream);
  }
  markPlaying(stream: MediaStream) {
    if (this.stream !== stream || !this.ready) return;
    this.firstFrameMs = Math.round(performance.now() - this.startedAt);
    this.ready.resolve(); this.ready = null;
  }
  playbackFailed(stream: MediaStream) {
    if (this.stream !== stream) return;
    const error = new Error('远端视频未能播放，本轮测试已停止。');
    this.ready?.reject(error); this.ready = null; this.failure?.(error);
  }
  stop() {
    this.cleanup?.(); this.cleanup = null;
    this.signal = null; this.failure = null;
    this.ready?.reject(new DOMException('已取消', 'AbortError')); this.ready = null;
    if (this.stream) { this.stream.getTracks().forEach((track) => track.stop()); this.publish(null); }
  }
}
