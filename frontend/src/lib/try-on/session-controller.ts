import { ACTIVE_PHASES, type Garment, type SessionSnapshot, type TryOnAdapter, type View } from './types';
import { DEFAULT_DURATION_SEC } from '../limits';
import { isDurationSec, type DurationSec } from '../studio/policy';

const initial = (durationSec: DurationSec = DEFAULT_DURATION_SEC): SessionSnapshot => ({ phase: 'idle', garment: null, consent: false, view: 'generated', deadlineAt: null, remainingSeconds: durationSec, durationSec, message: null });

/** 独立于 React 的会话控制器，便于验证取消、超时及异步竞态。 */
export class SessionController {
  private snapshot = initial();
  private listeners = new Set<() => void>();
  private work: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingGarment: Garment | null = null;
  private updating = false;
  private durationMs: number;
  private readonly now: () => number;

  constructor(private readonly adapter: TryOnAdapter, options: { durationMs?: number; now?: () => number } = {}) {
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_SEC * 1000;
    this.now = options.now ?? Date.now;
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<SessionSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener()); }
  private isCurrent(signal: AbortSignal): boolean { return this.work?.signal === signal && !signal.aborted; }

  setGarment(garment: Garment | null): void {
    if (!garment) { this.stop('参考图已移除，本次体验随之结束。'); this.patch({ garment: null, phase: 'idle', message: null }); return; }
    const active = ACTIVE_PHASES.has(this.snapshot.phase);
    this.patch({ garment, ...(!active ? { phase: 'imageReady', message: null } as const : {}) });
    if (this.snapshot.phase === 'live' || this.snapshot.phase === 'updatingGarment') {
      this.pendingGarment = garment;
      void this.flushGarment();
    } else if (active) {
      // 连接中选图也要在建连结束后应用，避免起始图覆盖最新选择。
      this.pendingGarment = garment;
    }
  }

  setConsent(consent: boolean): void { if (!consent) this.stop('你已取消画面处理确认，本次体验已结束。'); this.patch({ consent }); }
  setView(view: View): void { if (['live', 'updatingGarment'].includes(this.snapshot.phase)) this.patch({ view }); }
  setDuration(durationSec: DurationSec): void {
    if (!isDurationSec(durationSec) || ACTIVE_PHASES.has(this.snapshot.phase)) return;
    this.durationMs = durationSec * 1000;
    this.patch({ durationSec, remainingSeconds: durationSec, deadlineAt: null });
  }

  private beginDeadline(): void {
    if (this.snapshot.deadlineAt !== null) return;
    this.patch({ deadlineAt: this.now() + this.durationMs, remainingSeconds: Math.ceil(this.durationMs / 1000) });
    this.timer = setInterval(() => this.tick(), 200);
  }

  tick(): void {
    if (this.snapshot.deadlineAt === null || !ACTIVE_PHASES.has(this.snapshot.phase)) return;
    const remainingSeconds = Math.max(0, Math.ceil((this.snapshot.deadlineAt - this.now()) / 1000));
    if (remainingSeconds === 0) this.stop('本次换装已结束，可继续查看相机原画。');
    else if (remainingSeconds !== this.snapshot.remainingSeconds) this.patch({ remainingSeconds });
  }

  async start(): Promise<void> {
    const { garment, consent } = this.snapshot;
    if (!garment || !consent || ACTIVE_PHASES.has(this.snapshot.phase)) return;
    this.cancelWork();
    const operation = new AbortController();
    this.work = operation;
    this.patch({ phase: 'requestingCamera', message: null, deadlineAt: null, remainingSeconds: Math.ceil(this.durationMs / 1000), view: this.adapter.initialView ?? 'generated' });
    try {
      await this.adapter.connect({ garment, durationSec: this.snapshot.durationSec, signal: operation.signal, onError: (error) => this.handleError(error, operation.signal), onPhase: (phase) => {
        if (!this.isCurrent(operation.signal)) return;
        if (phase === 'connecting') this.beginDeadline();
        this.patch({ phase });
      } });
      if (!this.isCurrent(operation.signal)) return;
      this.tick();
      if (!this.isCurrent(operation.signal)) return;
      this.patch({ phase: 'live' });
      if (this.pendingGarment) void this.flushGarment();
    } catch (error) { this.handleError(error, operation.signal); }
  }

  private async flushGarment(): Promise<void> {
    const signal = this.work?.signal;
    if (!signal || this.updating || !this.isCurrent(signal)) return;
    this.updating = true;
    this.patch({ phase: 'updatingGarment' });
    try {
      while (this.pendingGarment && this.isCurrent(signal)) {
        const next = this.pendingGarment;
        this.pendingGarment = null;
        await this.adapter.updateGarment(next, signal);
      }
      if (this.isCurrent(signal)) this.patch({ phase: 'live' });
    } catch (error) { this.handleError(error, signal); }
    finally { if (this.work?.signal === signal) this.updating = false; }
  }

  private handleError(error: unknown, signal: AbortSignal): void {
    if (!this.isCurrent(signal)) return;
    const message = error instanceof Error ? error.message : '画面暂时无法准备，请稍后重试。';
    this.cancelWork();
    this.patch({ phase: 'error', message });
  }

  private cancelWork(): void {
    this.work?.abort(); this.work = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.pendingGarment = null; this.updating = false;
    this.adapter.stop();
  }

  stop(message = '换装已结束。'): void {
    if (!ACTIVE_PHASES.has(this.snapshot.phase)) return;
    this.cancelWork(); this.patch({ phase: 'ended', message });
  }

  reset(): void { this.cancelWork(); this.snapshot = initial(this.snapshot.durationSec); this.listeners.forEach((listener) => listener()); }
}
