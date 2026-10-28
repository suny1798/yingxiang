export type AdminTab = 'overview' | 'users' | 'usage' | 'video' | 'orders' | 'settings' | 'audit';
export type AdminPending = Readonly<{ path: string; body: Record<string, unknown>; summary: string }>;
export type AdminSnapshot = Readonly<{ tab: AdminTab; revision: number; pending: AdminPending | null; busy: boolean; error: string; denied: boolean }>;

export interface AdminPlatform {
  request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T>;
  requestId(): string;
  notify(message: string, kind: 'success' | 'error'): void;
  savedMessage(): string;
  failedMessage(): string;
  refreshAccount(): void;
}

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'AdminRequestError'; }
}

/** 管理控制台写入编排：确认后才POST，同一次修改复用操作编号，不自动重试；鉴权失败立即隐藏数据。 */
export class AdminConsole {
  private current: AdminSnapshot = { tab: 'overview', revision: 0, pending: null, busy: false, error: '', denied: false };
  private listeners = new Set<() => void>();
  private operation: { signature: string; id: string } | null = null;
  private readonly lifetime = new AbortController();
  private disposed = false;

  constructor(private readonly platform: AdminPlatform) {}

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AdminSnapshot>) {
    if (this.disposed) return;
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  select(tab: AdminTab) {
    if (this.current.busy || this.current.tab === tab) return;
    this.publish({ tab, error: '' });
  }
  prepare(pending: AdminPending) {
    if (this.current.busy) return;
    this.publish({ error: '', pending });
  }
  close() {
    if (this.current.busy) return;
    this.publish({ pending: null });
  }
  refresh() {
    if (this.current.busy) return;
    this.publish({ revision: this.current.revision + 1 });
    this.platform.refreshAccount();
  }

  async save() {
    const pending = this.current.pending;
    if (this.disposed || !pending || this.current.busy) return;
    this.publish({ busy: true, error: '' });
    const signature = JSON.stringify(pending);
    const operation = this.operation?.signature === signature ? this.operation : (this.operation = { signature, id: this.platform.requestId() });
    try {
      await this.platform.request(pending.path, { ...pending.body, requestId: operation.id }, this.lifetime.signal);
      if (this.disposed) return;
      this.operation = null;
      this.publish({ pending: null, revision: this.current.revision + 1 });
      this.platform.notify(this.platform.savedMessage(), 'success');
      this.platform.refreshAccount();
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error && error.message ? error.message : this.platform.failedMessage();
      if (error instanceof AdminRequestError && (error.status === 401 || error.status === 403)) {
        this.publish({ denied: true, pending: null });
        this.platform.refreshAccount();
      }
      this.publish({ error: message });
      this.platform.notify(message, 'error');
    } finally {
      this.publish({ busy: false });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.listeners.clear();
  }
}
