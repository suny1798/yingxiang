import type { AccountView } from './account';

interface AccountSnapshot { account: AccountView | null; error: string | null }
const initial: AccountSnapshot = { account: null, error: null };

/** 浏览器内存中的显示状态；真实操作仍重新读取账号并由后端授权。 */
export class AccountSession {
  private snapshot = initial;
  private listeners = new Set<() => void>();
  private revision = 0;
  private pending: Promise<AccountView | null> | null = null;
  constructor(private readonly request = () => fetch('/api/account/me', { cache: 'no-store' })) {}
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initial;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: AccountSnapshot) { this.snapshot = value; this.listeners.forEach((listener) => listener()); }
  /** 显式刷新始终请求服务器，并使较早的响应失效。 */
  refresh = (): Promise<AccountView | null> => {
    const operation = ++this.revision;
    const pending = (async () => {
      try {
        const response = await Promise.resolve().then(this.request);
        if (!response.ok) throw new Error('暂时无法读取账号，请稍后重试。');
        const account = await response.json() as AccountView;
        if (operation !== this.revision) return null;
        this.publish({ account, error: null }); return account;
      } catch (error) {
        if (operation === this.revision) this.publish({ account: this.snapshot.account, error: error instanceof Error ? error.message : '账号暂不可用。' });
        return null;
      } finally { if (operation === this.revision) this.pending = null; }
    })();
    this.pending = pending; return pending;
  };
  revalidate = () => this.pending ?? this.refresh();
}

export const accountSession = new AccountSession();
