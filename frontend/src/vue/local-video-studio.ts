import { GarmentInput } from '../lib/images/garment-input';
import { VIDEO_POLICY } from '../lib/video/policy';
import type { SessionScope } from './session-scope';

export type LocalVideoSnapshot = Readonly<{ file: File | null; url: string | null; seconds: number | null; hasAudio: boolean; validating: boolean; error: string | null }>;

export interface LocalVideoPlatform {
  read(file: File): Promise<Uint8Array>;
  inspect(bytes: Uint8Array): { seconds: number; hasAudio?: boolean };
  createURL(file: File): string;
  revokeURL(url: string): void;
  notify(message: string, kind: 'success' | 'error' | 'info'): void;
  translate(message: string): string;
}

/** 只在本机校验和预览人物视频；不读取正式库、不上传、不提交任务。 */
export class LocalVideoFile {
  private value: LocalVideoSnapshot = { file: null, url: null, seconds: null, hasAudio: false, validating: false, error: null };
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;

  constructor(private platform: LocalVideoPlatform) {}

  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<LocalVideoSnapshot>) { this.value = { ...this.value, ...patch }; this.listeners.forEach((listener) => listener()); }
  private current(revision: number) { return !this.disposed && revision === this.revision; }
  private release() { if (this.value.url) this.platform.revokeURL(this.value.url); }
  private fail(message: string) {
    this.publish({ validating: false, error: message });
    this.platform.notify(this.platform.translate(message), 'error');
  }

  /** 选择或替换视频；校验期间再次选择、隐藏或取消都会丢弃迟到结果。 */
  async choose(file: File | null) {
    if (this.disposed) return;
    this.cancel();
    if (!file) return;
    if (file.size > VIDEO_POLICY.maxBytes || !file.name.toLowerCase().endsWith('.mp4')) { this.fail('请选择不超过25MB的MP4视频。'); return; }
    const revision = ++this.revision;
    this.publish({ validating: true, error: null });
    try {
      const bytes = await this.platform.read(file);
      if (!this.current(revision)) return;
      const info = this.platform.inspect(bytes);
      if (!this.current(revision)) return;
      const url = this.platform.createURL(file);
      if (!this.current(revision)) { this.platform.revokeURL(url); return; }
      this.release();
      this.publish({ file, url, seconds: info.seconds, hasAudio: Boolean(info.hasAudio), validating: false });
      this.platform.notify(this.platform.translate('视频已准备好。'), 'success');
      if (info.hasAudio) this.platform.notify(this.platform.translate('检测到音轨；本机预览为静音，云端提交时会自动移除。'), 'info');
    } catch (cause) {
      if (!this.current(revision)) return;
      this.fail(cause instanceof Error ? cause.message : '视频无法读取。');
    }
  }

  /** 隐藏或取消只停止校验，已就绪的视频仍可继续预览。 */
  cancel() {
    if (this.disposed) return;
    ++this.revision;
    if (this.value.validating) this.publish({ validating: false });
  }

  remove() {
    if (this.disposed) return;
    this.cancel(); this.release();
    this.publish({ file: null, url: null, seconds: null, hasAudio: false, validating: false, error: null });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.revision;
    this.release();
    this.value = { file: null, url: null, seconds: null, hasAudio: false, validating: false, error: null };
    this.listeners.clear();
  }
}

/** 页面拥有视频URL与参考图；已认证身份变化时清空，访客登录保留仍有效的本机素材。 */
export class LocalVideoMedia {
  readonly video: LocalVideoFile;
  readonly input: GarmentInput;
  private owner: string | null;
  private stopIdentity: () => void;
  private active = true;

  constructor(scope: SessionScope, platform: LocalVideoPlatform, images?: ConstructorParameters<typeof GarmentInput>[1]) {
    this.video = new LocalVideoFile(platform);
    this.input = new GarmentInput(() => {}, images);
    this.owner = scope.capture().userId;
    this.stopIdentity = scope.onIdentityChange(() => {
      if (this.owner) { this.video.remove(); this.input.clear(); } else this.input.cancel();
      this.owner = scope.capture().userId;
    });
  }

  hidden() { this.video.cancel(); this.input.cancel(); }
  dispose() { if (!this.active) return; this.active = false; this.stopIdentity(); this.video.dispose(); this.input.dispose(); }
}
