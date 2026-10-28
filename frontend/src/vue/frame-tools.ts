import type { SessionScope } from './session-scope';

export type FrameToolsSnapshot = Readonly<{ mirrored: boolean; fullscreen: boolean; supported: boolean; capturing: boolean }>;

/** 全屏与可见性只经此接口观察，测试使用明确替身，不伪造浏览器结果。 */
export interface FrameHost {
  readonly hidden: boolean;
  readonly fullscreenEnabled: boolean;
  readonly fullscreenElement: Element | null;
  requestFullscreen(element: HTMLElement): Promise<void>;
  exitFullscreen(): Promise<void>;
  onFullscreenChange(listener: () => void): () => void;
  onHidden(listener: () => void): () => void;
  onPageHide(listener: () => void): () => void;
}

export interface FrameToolsPlatform {
  capture(video: HTMLVideoElement | null, mirrored: boolean): Promise<Blob>;
  download(blob: Blob, filename: string): void;
  stamp(): string;
  notify(message: string, kind: 'success' | 'error'): void;
  translate(message: string): string;
}

/** 页面拥有镜像、全屏与截图操作；取消后迟到的PNG不得下载或通知。 */
export class LocalFrameTools {
  private value: FrameToolsSnapshot = { mirrored: true, fullscreen: false, supported: false, capturing: false };
  private listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private operation = 0;
  private disposed = false;
  private readonly stopScope: (() => void) | undefined;

  constructor(private host: FrameHost, private platform: FrameToolsPlatform, private options: { stage: () => HTMLElement | null; video: () => HTMLVideoElement | null; stem: () => string; scope?: SessionScope; mirrored?: boolean }) {
    this.value = { mirrored: options.mirrored ?? true, fullscreen: false, supported: Boolean(host.fullscreenEnabled), capturing: false };
    this.stops.push(host.onFullscreenChange(() => this.syncFullscreen()));
    this.stops.push(host.onHidden(() => { if (this.host.hidden) this.cancel(); }));
    this.stops.push(host.onPageHide(() => this.cancel()));
    this.stopScope = options.scope?.onIdentityChange(() => this.cancel());
  }

  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<FrameToolsSnapshot>) { this.value = { ...this.value, ...patch }; this.listeners.forEach((listener) => listener()); }
  private syncFullscreen() { const fullscreen = this.host.fullscreenElement !== null && this.host.fullscreenElement === this.options.stage(); if (fullscreen !== this.value.fullscreen) this.publish({ fullscreen }); }
  private current(operation: number) { return !this.disposed && operation === this.operation && !this.host.hidden; }

  toggleMirror() { if (!this.disposed) this.publish({ mirrored: !this.value.mirrored }); }

  async toggleFullscreen() {
    if (this.disposed) return;
    try {
      if (this.host.fullscreenElement) await this.host.exitFullscreen();
      else {
        const stage = this.options.stage();
        if (!stage) throw new Error('unsupported');
        await this.host.requestFullscreen(stage);
      }
    } catch {
      if (!this.disposed) this.platform.notify(this.platform.translate('暂时无法切换全屏，请检查浏览器权限后重试。'), 'error');
    }
  }

  /** 只读取点击时的当前帧；镜像在开始时固定，切换镜像不改写本轮导出的像素。 */
  async capture() {
    if (this.disposed || this.value.capturing) return;
    const operation = ++this.operation, mirrored = this.value.mirrored, video = this.options.video();
    this.publish({ capturing: true });
    try {
      const blob = await this.platform.capture(video, mirrored);
      if (!this.current(operation)) return;
      this.platform.download(blob, `${this.options.stem()}-${this.platform.stamp()}`);
      this.platform.notify(this.platform.translate('已导出当前画面，截图仅保存在你选择的位置。'), 'success');
    } catch (cause) {
      if (!this.current(operation)) return;
      this.platform.notify(this.platform.translate(cause instanceof Error ? cause.message : '截图未完成，请稍后重试。'), 'error');
    } finally {
      if (this.current(operation) && this.value.capturing) this.publish({ capturing: false });
    }
  }

  /** 隐藏、pagehide、换账号或卸载后到达的截图结果直接丢弃。 */
  cancel() {
    if (this.disposed) return;
    ++this.operation;
    if (this.value.capturing) this.publish({ capturing: false });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.operation;
    this.stops.forEach((stop) => stop());
    this.stops = [];
    this.stopScope?.();
    this.listeners.clear();
    if (this.host.fullscreenElement !== null && this.host.fullscreenElement === this.options.stage()) void this.host.exitFullscreen().catch(() => {});
  }
}
