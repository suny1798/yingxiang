import { PROMPT_POLICY } from './policy';
import { promptStateText } from './composition';
import type { PromptAdapter } from './adapter';
import type { WorkPromptState } from '../api-schema';
import { connectionTimeoutMessage, CONNECTION_STAGE_LABELS, type ConnectionStep } from './connection-diagnostics';
export type PromptPhase = 'idle' | 'connecting' | 'live' | 'updating' | 'ended' | 'error';
export interface PromptSnapshot {
  phase: PromptPhase; draft: string; applied: string | null; applying: string | null;
  consent: boolean; durationSec:15|30; remaining: number; deadlineAt: number | null; message: string | null;
  connectionSteps: ConnectionStep[];
  history: WorkPromptState[];
}
export const promptActive = (phase: PromptPhase) => ['connecting', 'live', 'updating'].includes(phase);
export class PromptSession {
  private snapshot: PromptSnapshot = { phase: 'idle', draft: '', applied: null, applying: null, consent: false, durationSec:15, remaining: PROMPT_POLICY.durationSec, deadlineAt: null, message: null, connectionSteps: [], history: [] };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectionDeadlineAt: number | null = null;
  private pending: { prompt: string; instructions: string[] } | null = null;
  private draftInstructions: string[] = [];
  private updating = false;
  constructor(private readonly adapter: PromptAdapter, private readonly now = Date.now) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<PromptSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach((listener) => listener()); }
  private current(signal: AbortSignal) { return this.operation?.signal === signal && !signal.aborted; }
  private confirmedHistory(instructions: string[]) {
    const began = (this.snapshot.deadlineAt ?? this.now()) - this.snapshot.durationSec * 1000;
    return [...this.snapshot.history, { atMs: Math.min(this.snapshot.durationSec*1000, Math.max(0, this.now() - began)), instructions }];
  }
  setDraft(draft: string, instructions: readonly string[] = [draft]) { this.draftInstructions = [...instructions]; this.patch({ draft }); }
  /** UI列表变化只在已有连接内同步；空组合直接回到相机原画。 */
  syncComposition(prompt: string, instructions?: readonly string[]) {
    this.setDraft(prompt, instructions);
    if (!prompt) { this.stop('已移除全部提示词，生成已结束，已恢复相机原画。'); return; }
    if (this.operation) this.apply();
  }
  setConsent(consent: boolean) { if (!consent) this.stop('已取消云端处理确认。'); this.patch({ consent }); }
  setDuration(durationSec:15|30) { if(!promptActive(this.snapshot.phase)&&[15,30].includes(durationSec))this.patch({durationSec,remaining:durationSec}); }
  tick = () => {
    if (!this.operation) return;
    if (this.connectionDeadlineAt !== null && this.now() >= this.connectionDeadlineAt) {
      this.fail(new Error(connectionTimeoutMessage(this.snapshot.connectionSteps)), this.operation.signal);
      return;
    }
    if (this.snapshot.deadlineAt === null) return;
    const remaining = Math.max(0, Math.ceil((this.snapshot.deadlineAt - this.now()) / 1000));
    if (remaining === 0) {
      this.patch({ remaining: 0 });
      this.stop('本次实时编辑已结束，相机原画可继续预览。');
    } else this.patch({ remaining });
  };
  async start() {
    if (this.operation || !this.snapshot.consent) return;
    let prompt: string;
    try { prompt = promptStateText(this.snapshot.draft); } catch (error) { this.patch({ message: (error as Error).message }); return; }
    const operation = new AbortController(); this.operation = operation;
    const instructions = [...this.draftInstructions];
    const startedAt = this.now();
    this.connectionDeadlineAt = startedAt + PROMPT_POLICY.connectionTimeoutMs;
    this.patch({ phase: 'connecting', applied: null, applying: prompt, message: null, deadlineAt: null, remaining: this.snapshot.durationSec, connectionSteps: [], history: [] });
    this.timer = setInterval(this.tick, 200);
    try {
      await this.adapter.connect({ prompt, durationSec:this.snapshot.durationSec, signal: operation.signal, onError: (error) => this.fail(error, operation.signal), onProgress: (stage) => {
        if (!this.current(operation.signal) || !Object.hasOwn(CONNECTION_STAGE_LABELS, stage) || this.snapshot.connectionSteps.at(-1)?.stage === stage) return;
        this.patch({ connectionSteps: [...this.snapshot.connectionSteps, { stage, elapsedMs: Math.min(120_000, Math.max(0, this.now() - startedAt)) }].slice(-20) });
      } });
      if (!this.current(operation.signal)) return;
      this.tick(); if (!this.current(operation.signal)) return;
      // 适配器仅在远端视频实际开始播放后完成；此前的状态读取/签发/建连不扣体验时间。
      this.connectionDeadlineAt = null;
      this.patch({ phase: 'live', applied: prompt, applying: null, deadlineAt: this.now() + this.snapshot.durationSec * 1000, remaining: this.snapshot.durationSec, history: [{ atMs: 0, instructions }] });
      if (this.pending) void this.flush();
    } catch (error) { this.fail(error, operation.signal); }
  }
  apply() {
    if (!this.operation) return;
    let prompt: string;
    try { prompt = promptStateText(this.snapshot.draft); } catch (error) { this.patch({ message: (error as Error).message }); return; }
    this.pending = { prompt, instructions: [...this.draftInstructions] };
    if (this.snapshot.phase !== 'connecting') void this.flush();
  }
  private async flush() {
    const signal = this.operation?.signal;
    if (!signal || this.updating || !this.current(signal)) return;
    this.updating = true;
    try {
      while (this.pending !== null && this.current(signal)) {
        const next = this.pending; this.pending = null;
        if (next.prompt === this.snapshot.applied) continue;
        this.patch({ phase: 'updating', applying: next.prompt, message: null });
        await this.adapter.update(next.prompt, signal);
        if (this.current(signal)) this.patch({ applied: next.prompt, history: this.confirmedHistory(next.instructions) });
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
    this.timer = null; this.connectionDeadlineAt = null; this.pending = null; this.updating = false; this.adapter.stop();
  }
  stop(message = '实时编辑已结束。') { if (!this.operation) return; this.cancel(); this.patch({ phase: 'ended', applying: null, message }); }
  dispose() { this.cancel(); }
}
