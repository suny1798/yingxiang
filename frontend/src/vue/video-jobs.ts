import type { PreparationProgress } from '../lib/video/prepare';
import type { VideoJobView, VideoServiceView } from '../lib/video/policy';
import { refreshVideoSelection } from '../lib/video/history-selection';
import type { SessionScope } from './session-scope';

export type VideoJobsState = Readonly<{
  owner: string | null;
  service: VideoServiceView | null;
  selected: VideoJobView | null;
  loading: boolean;
  submitting: boolean;
  preparing: boolean;
  preparation: PreparationProgress | null;
  error: string | null;
  unknown: boolean;
}>;

export type VideoSubmitInput = Readonly<{ attemptId: string; file: File; garment: Blob; consentVersion: string }>;

export interface VideoJobsPlatform {
  fetchService(signal: AbortSignal): Promise<VideoServiceView>;
  fetchJob(signal: AbortSignal, id: string): Promise<VideoJobView>;
  submit(signal: AbortSignal, input: VideoSubmitInput): Promise<VideoJobView>;
  prepare(signal: AbortSignal, file: File, onProgress: (value: PreparationProgress) => void): Promise<Blob>;
  inspect(bytes: Uint8Array): { seconds: number; hasAudio?: boolean };
  hidden(): boolean;
  notify(message: string, kind: 'success' | 'error' | 'info'): void;
  translate(message: string): string;
}

export const inProgress = (job: VideoJobView) => ['pending', 'processing'].includes(job.state) && !job.expired;
const UNKNOWN_MESSAGE = '提交结果尚未确认，请刷新任务核查，不要再次生成。';

/** 视频任务只经SessionScope读写；unknown只恢复列表，不自动补发POST。 */
export class VideoJobs {
  private current: VideoJobsState = { owner: null, service: null, selected: null, loading: false, submitting: false, preparing: false, preparation: null, error: null, unknown: false };
  private listeners = new Set<() => void>();
  private loadController: AbortController | null = null;
  private pollController: AbortController | null = null;
  private submitController: AbortController | null = null;
  private preparationController: AbortController | null = null;
  private attemptId: string | null = null;
  private disposed = false;
  private readonly stopIdentity: () => void;

  constructor(private scope: SessionScope, private platform: VideoJobsPlatform) {
    this.stopIdentity = scope.onIdentityChange(() => {
      this.abort();
      this.attemptId = null;
      this.publish({ owner: null, service: null, selected: null, loading: false, submitting: false, preparing: false, preparation: null, error: null, unknown: false });
      if (scope.capture().userId) void this.load();
    });
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<VideoJobsState>) { if (this.disposed) return; this.current = { ...this.current, ...patch }; this.listeners.forEach((listener) => listener()); }
  private abort() {
    this.loadController?.abort(); this.loadController = null;
    this.pollController?.abort(); this.pollController = null;
    this.submitController?.abort(); this.submitController = null;
    this.preparationController?.abort(); this.preparationController = null;
  }
  private fail(message: string) {
    this.publish({ error: message });
    this.platform.notify(this.platform.translate(message), 'error');
  }

  /** 只读取本人服务状态与最近任务；未登录不发私有请求。 */
  async load(silent = false) {
    if (this.disposed) return;
    const token = this.scope.capture();
    this.loadController?.abort(); this.loadController = null;
    if (!token.userId) { this.publish({ owner: null, service: null, selected: null, loading: false, error: null, unknown: false }); return; }
    const controller = new AbortController(); this.loadController = controller;
    if (!silent) this.publish({ loading: true, error: null });
    try {
      const service = await this.platform.fetchService(controller.signal);
      if (controller.signal.aborted) return;
      this.scope.assertCurrent(token);
      this.publish({ owner: token.userId, service, selected: refreshVideoSelection(this.current.selected, service.jobs), loading: false, error: null });
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.publish({ loading: false, error: cause instanceof Error ? cause.message : '任务读取失败。' });
    } finally {
      if (this.loadController === controller) this.loadController = null;
    }
  }

  /** 仅页面可见时轮询处理中的任务；完成后重读列表。 */
  async poll() {
    if (this.disposed || this.platform.hidden()) return;
    const ids = this.current.service?.jobs.filter(job=>inProgress(job)||(!job.expired&&job.resultPending)).map((job) => job.id) ?? [];
    if (!ids.length) return;
    const token = this.scope.capture();
    if (!token.userId) return;
    const controller = new AbortController(); this.pollController?.abort(); this.pollController = controller;
    let finished = false;
    try {
      for (const id of ids) {
        const job = await this.platform.fetchJob(controller.signal, id);
        if (controller.signal.aborted) return;
        this.scope.assertCurrent(token);
        const service = this.current.service;
        this.publish({
          service: service && { ...service, jobs: service.jobs.map((item) => item.id === job.id ? job : item) },
          selected: this.current.selected?.id === job.id ? { ...this.current.selected, ...job } : this.current.selected,
        });
        if (!inProgress(job)) finished = true;
      }
      if (finished) await this.load(true);
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.publish({ error: cause instanceof Error ? cause.message : '进度读取失败，可手动刷新。' });
    } finally {
      if (this.pollController === controller) this.pollController = null;
    }
  }

  async refresh() { await this.poll(); await this.load(); }

  /** 含音轨时先经本站预处理；准备结果只用于本次提交，不替换本机预览。 */
  async submit(input: Readonly<{ file: File; garment: Blob; hasAudio: boolean; consentVersion: string }>): Promise<VideoJobView | null> {
    if (this.disposed || this.current.submitting || this.current.preparing) return null;
    const token = this.scope.capture();
    if (!token.userId) { this.fail('请先登录后继续。'); return null; }
    const attemptId = this.attemptId ??= crypto.randomUUID();
    const controller = new AbortController(); this.submitController = controller;
    this.publish({ submitting: true, error: null, unknown: false });
    try {
      let file = input.file;
      if (input.hasAudio) {
        const prepared = await this.prepareFile(input.file, token);
        if (!prepared) return null;
        file = new File([prepared], input.file.name, { type: 'video/mp4', lastModified: input.file.lastModified });
      }
      if (controller.signal.aborted) return null;
      this.scope.assertCurrent(token);
      const job = await this.platform.submit(controller.signal, { attemptId, file, garment: input.garment, consentVersion: input.consentVersion });
      if (controller.signal.aborted) return null;
      this.scope.assertCurrent(token);
      this.publish({ selected: job, unknown: false, error: null });
      this.platform.notify(this.platform.translate('视频已提交处理，可在“我的作品”查看进度和保存结果。'), 'success');
      await this.load(true);
      return job;
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return null;
      this.publish({ error: UNKNOWN_MESSAGE, unknown: true });
      this.platform.notify(this.platform.translate(UNKNOWN_MESSAGE), 'error');
      await this.recover(attemptId, token);
      return null;
    } finally {
      if (this.submitController === controller) this.submitController = null;
      if (!this.disposed) this.publish({ submitting: false });
    }
  }

  private async prepareFile(file: File, token: ReturnType<SessionScope['capture']>): Promise<Blob | null> {
    const controller = new AbortController(); this.preparationController = controller;
    this.publish({ preparing: true, preparation: { stage: 'upload', percent: 0 }, error: null });
    try {
      const blob = await this.platform.prepare(controller.signal, file, (progress) => {
        if (controller.signal.aborted || !this.scope.current(token)) return;
        this.publish({ preparation: progress });
      });
      controller.signal.throwIfAborted();
      this.scope.assertCurrent(token);
      this.platform.inspect(new Uint8Array(await blob.arrayBuffer()));
      return blob;
    } catch (cause) {
      if (controller.signal.aborted) { this.platform.notify(this.platform.translate('已取消视频处理。'), 'info'); return null; }
      if (!this.scope.current(token)) return null;
      this.fail(cause instanceof Error ? cause.message : '视频自动处理未完成，请稍后重新选择。');
      return null;
    } finally {
      if (this.preparationController === controller) this.preparationController = null;
      if (!this.disposed) this.publish({ preparing: false, preparation: null });
    }
  }

  /** 网络未知后只读列表；命中同一提交编号才恢复选中，绝不再次POST。 */
  private async recover(attemptId: string, token: ReturnType<SessionScope['capture']>) {
    await this.load(true);
    if (this.disposed || !this.scope.current(token)) return;
    const found = this.current.service?.jobs.find((job) => job.id === attemptId);
    if (!found) {
      if (this.current.unknown) this.publish({ error: UNKNOWN_MESSAGE });
      return;
    }
    this.publish({ selected: found, unknown: false, error: null });
    this.platform.notify(this.platform.translate('已从任务列表恢复本次提交，请查看状态，不要再次生成。'), 'info');
  }

  cancelPreparation() { this.preparationController?.abort(); }
  hidden() {
    if (!this.platform.hidden()) return;
    this.cancelPreparation();
    this.submitController?.abort(); this.submitController = null;
    this.pollController?.abort(); this.pollController = null;
  }
  resetAttempt() { this.attemptId = null; this.publish({ unknown: false, error: null }); }
  select(job: VideoJobView | null) { this.publish({ selected: job }); }
  clearSelected() { this.select(null); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort(); this.stopIdentity(); this.listeners.clear();
  }
}
