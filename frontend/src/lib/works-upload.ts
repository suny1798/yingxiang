/** 分片顺序上传独立于页面；每次写入都绑定录制发起账号，绝不归入后来登录的账号。 */
import type { WorkPromptState } from './api-schema';
export interface RecordingSink {
  start(mime: string): void;
  chunk(blob: Blob): void;
  complete(): void;
  fail(message: string): void;
}
export interface ReferenceImage { id: string; blob?: Blob }
export type SaveSnapshot = { phase: 'idle' | 'saving' | 'saved' | 'error'; message: string | null; id: string | null };
const idle: SaveSnapshot = { phase: 'idle', message: null, id: null };

export class WorkUpload implements RecordingSink {
  readonly id = crypto.randomUUID();
  private chain: Promise<unknown> = Promise.resolve();
  private started = false;
  private finished = false;
  private index = 0;
  private failed = false;
  private referenceFailed = false;
  private promptsFailed = false;
  private promptHistory: WorkPromptState[] = [];
  private interrupted = false;
  private began = 0;
  private references = new Map<string, Blob>();
  constructor(private owner: string, private kind: 'realtime' | 'edit', private seconds: number,
    private publish: (value: SaveSnapshot) => void, private request: typeof fetch = (input, init) => fetch(input, init)) {}

  private async call(path: string, body?: BodyInit, type = 'application/json', method = 'POST') {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.request(path, { method, headers: { 'Content-Type': type, 'X-Work-Owner': this.owner }, body,
          signal: AbortSignal.timeout(120_000), cache: 'no-store' });
        if (!response.ok) {
          const value = await response.json().catch(() => null);
          const error = Object.assign(new Error(value?.error?.message ?? '作品保存未完成，请到我的作品查看状态。'), { status: response.status });
          throw error;
        }
        return await response.json();
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (attempt >= 1 || (status && status < 500)) throw error;
      }
    }
  }
  private enqueue(task: () => Promise<unknown>) {
    this.chain = this.chain.then(task).catch(error => {
      this.failed = true;
      this.publish({ phase: 'error', message: error instanceof Error ? error.message : '作品保存未完成。', id: this.id });
      throw error;
    });
    // 每段链均有拒绝处理，后台完成会统一收尾。
    void this.chain.catch(() => {});
  }
  start(mime: string) {
    if (this.started) return;
    this.started = true; this.began = Date.now();
    this.publish({ phase: 'saving', message: null, id: this.id });
    this.enqueue(() => this.call('/api/works', JSON.stringify({ id: this.id, ownerId: this.owner, kind: this.kind, mime: mime.split(';')[0], seconds: this.seconds })));
    for (const blob of this.references.values()) this.uploadReference(crypto.randomUUID(), blob);
    this.promptHistory.forEach((state, index) => this.uploadPrompt(index, state));
  }
  addPromptHistory(history: readonly WorkPromptState[]) {
    if (this.kind !== 'edit' || this.finished) return;
    for (let index = this.promptHistory.length; index < history.length; index++) {
      const state = { atMs: history[index].atMs, instructions: [...history[index].instructions] };
      this.promptHistory.push(state);
      if (this.started) this.uploadPrompt(index, state);
    }
  }
  private uploadPrompt(index: number, state: WorkPromptState) {
    this.enqueue(async () => {
      try { await this.call(`/api/works/${this.id}/prompts/${index}`, JSON.stringify(state)); }
      catch { this.promptsFailed = true; }
    });
  }
  addReference(reference: ReferenceImage | null) {
    if (!reference?.blob || this.references.has(reference.id) || this.finished) return;
    const id = crypto.randomUUID();
    this.references.set(reference.id, reference.blob);
    if (this.started) this.uploadReference(id, reference.blob);
  }
  private uploadReference(id: string, blob: Blob) {
    // 服装ID只用于前端去重，文件名由独立UUID生成。
    const ref = /^[0-9a-f-]{36}$/i.test(id) ? id : crypto.randomUUID();
    this.enqueue(async () => {
      try { await this.call(`/api/works/${this.id}/references/${ref}`, blob, blob.type); }
      catch { this.referenceFailed = true; }
    });
  }
  chunk(blob: Blob) {
    if (!this.started || this.finished || !blob.size) return;
    const index = this.index++;
    this.enqueue(() => this.call(`/api/works/${this.id}/chunks/${index}`, blob, 'application/octet-stream'));
  }
  complete() {
    if (!this.started || this.finished) return;
    this.finished = true;
    void (async () => {
      try {
        await this.chain;
        await this.call(`/api/works/${this.id}/complete`, JSON.stringify({ referenceFailed: this.referenceFailed, promptsFailed: this.promptsFailed, interrupted: this.interrupted, durationMs: Math.min(this.seconds * 1000, Date.now() - this.began) }));
        for (let count = 0; count < 30; count++) {
          const item = await this.call(`/api/works/${this.id}`, undefined, 'application/json', 'GET');
          if (item.state === 'failed') throw new Error(item.message ?? '作品保存未完成。');
          if (item.state === 'ready') {
            this.publish({ phase: 'saved', message: item.message, id: this.id });
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('yingxiang:works-changed'));
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        this.publish({ phase: 'saving', message: '后台正在保存，可到我的作品查看。', id: this.id });
      } catch (error) {
        this.publish({ phase: 'error', message: error instanceof Error ? error.message : '作品保存未完成。', id: this.id });
        // 已传片段仍请求合并；失败时后端会在超时后收尾，不重启生成。
        if (this.failed) void this.call(`/api/works/${this.id}/complete`, JSON.stringify({ referenceFailed: this.referenceFailed, interrupted: true })).catch(() => {});
      }
    })();
  }
  fail(message: string) { this.interrupted = true; this.publish({ phase: 'error', message, id: this.id }); this.complete(); }
}

export const emptySave = idle;
