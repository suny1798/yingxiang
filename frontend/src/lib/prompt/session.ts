import { PROMPT_POLICY, promptText } from './policy';
import type { PromptAdapter } from './adapter';
export type PromptPhase = 'idle' | 'connecting' | 'live' | 'updating' | 'ended' | 'error';
export interface PromptSnapshot {
  phase: PromptPhase; draft: string; applied: string | null; applying: string | null;
  consent: boolean; remaining: number; deadlineAt: number | null; message: string | null;
}
export const promptActive = (phase: PromptPhase) => ['connecting', 'live', 'updating'].includes(phase);
export class PromptSession {
  private snapshot: PromptSnapshot = { phase: 'idle', draft: '', applied: null, applying: null, consent: false, remaining: PROMPT_POLICY.durationSec, deadlineAt: null, message: null };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: string | null = null;
  private updating = false;
  constructor(private readonly adapter: PromptAdapter, private readonly now = Date.now) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<PromptSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach((listener) => listener()); }
  private current(signal: AbortSignal) { return this.operation?.signal === signal && !signal.aborted; }
  setDraft(draft: string) { this.patch({ draft: draft.slice(0, PROMPT_POLICY.maxPromptLength) }); }
  setConsent(consent: boolean) { if (!consent) this.stop('已取消云端处理确认。'); this.patch({ consent }); }
  tick = () => {
    if (!this.operation || this.snapshot.deadlineAt === null) return;
    const remaining = Math.max(0, Math.ceil((this.snapshot.deadlineAt - this.now()) / 1000));
    if (remaining === 0) this.stop('本次实时编辑已结束，相机原画可继续预览。'); else this.patch({ remaining });
  };
  async start() {
    if (this.operation || !this.snapshot.consent) return;
    let prompt: string;
    try { prompt = promptText(this.snapshot.draft); } catch (error) { this.patch({ message: (error as Error).message }); return; }
    const operation = new AbortController(); this.operation = operation;
    this.patch({ phase: 'connecting', applied: null, applying: prompt, message: null, deadlineAt: this.now() + PROMPT_POLICY.durationSec * 1000, remaining: PROMPT_POLICY.durationSec });
    this.timer = setInterval(this.tick, 200);
    try {
      await this.adapter.connect({ prompt, signal: operation.signal, onError: (error) => this.fail(error, operation.signal) });
      if (!this.current(operation.signal)) return;
      this.tick(); if (!this.current(operation.signal)) return;
      this.patch({ phase: 'live', applied: prompt, applying: null });
      if (this.pending) void this.flush();
    } catch (error) { this.fail(error, operation.signal); }
  }
  apply() {
    if (!this.operation) return;
    let prompt: string;
    try { prompt = promptText(this.snapshot.draft); } catch (error) { this.patch({ message: (error as Error).message }); return; }
    this.pending = prompt;
    if (this.snapshot.phase !== 'connecting') void this.flush();
  }
  private async flush() {
    const signal = this.operation?.signal;
    if (!signal || this.updating || !this.current(signal)) return;
    this.updating = true;
    try {
      while (this.pending !== null && this.current(signal)) {
        const next = this.pending; this.pending = null;
        if (next === this.snapshot.applied) continue;
        this.patch({ phase: 'updating', applying: next, message: null });
        await this.adapter.update(next, signal);
        if (this.current(signal)) this.patch({ applied: next });
      }
      if (this.current(signal)) this.patch({ phase: 'live', applying: null });
    } catch (error) { this.fail(error, signal); }
    finally { if (this.operation?.signal === signal) this.updating = false; }
  }
  private fail(error: unknown, signal: AbortSignal) {
    if (!this.current(signal)) return;
    this.cancel(); this.patch({ phase: 'error', applying: null, message: error instanceof Error ? error.message : '实时编辑未能继续，请核查后再试。' });
  }
  private cancel() {
    this.operation?.abort(); this.operation = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.pending = null; this.updating = false; this.adapter.stop();
  }
  stop(message = '实时编辑已结束。') { if (!this.operation) return; this.cancel(); this.patch({ phase: 'ended', applying: null, message }); }
  dispose() { this.cancel(); }
}
