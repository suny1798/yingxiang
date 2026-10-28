import type { WorkItem, WorkPage } from '../lib/api-schema';
import type { SessionScope } from './session-scope';

export type WorkKind = 'all' | 'realtime' | 'video' | 'edit';
export type WorkSort = 'newest' | 'oldest' | 'title';
export type WorksFilters = Readonly<{ kind: WorkKind; page: number; query: string; sort: WorkSort; favoritesOnly: boolean }>;
export type WorksIndexState = Readonly<WorksFilters & { searchInput: string; owner: string | null; list: WorkPage | null; loading: boolean; error: string | null; favoriteBusy: string | null }>;

export interface WorksPlatform {
  fetchWorks(signal: AbortSignal, filters: WorksFilters): Promise<WorkPage>;
  setFavorite(signal: AbortSignal, id: string, favorite: boolean, owner: string): Promise<WorkItem>;
  hidden(): boolean;
  notify(message: string, kind: 'success' | 'error'): void;
  translate(message: string): string;
}

/** 列表只经SessionScope读取；退出或换账号后旧响应与旧列表都不得进入新账号。 */
export class WorksIndex {
  private current: WorksIndexState = { kind: 'all', page: 1, searchInput: '', query: '', sort: 'newest', favoritesOnly: false, owner: null, list: null, loading: false, error: null, favoriteBusy: null };
  private listeners = new Set<() => void>();
  private inflight: AbortController | null = null;
  private favorite: AbortController | null = null;
  private disposed = false;
  private readonly stopIdentity: () => void;

  constructor(private scope: SessionScope, private platform: WorksPlatform) {
    this.stopIdentity = scope.onIdentityChange(() => {
      this.abort();
      this.publish({ owner: null, list: null, error: null, loading: false, favoriteBusy: null });
      void this.load();
    });
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<WorksIndexState>) { this.current = { ...this.current, ...patch }; this.listeners.forEach((listener) => listener()); }
  private filters(): WorksFilters { const { kind, page, query, sort, favoritesOnly } = this.current; return { kind, page, query, sort, favoritesOnly }; }
  private abort() { this.inflight?.abort(); this.inflight = null; this.favorite?.abort(); this.favorite = null; }

  setKind(kind: WorkKind) { if (this.current.kind === kind) return; this.publish({ kind, page: 1 }); void this.load(); }
  setPage(page: number) { if (page < 1 || page === this.current.page) return; this.publish({ page }); void this.load(); }
  setSearchInput(searchInput: string) { this.publish({ searchInput }); }
  submitSearch() { const query = this.current.searchInput.trim(); if (query === this.current.query && this.current.page === 1) return; this.publish({ query, page: 1 }); void this.load(); }
  clearSearch() { this.publish({ searchInput: '', query: '', page: 1 }); void this.load(); }
  setSort(sort: WorkSort) { if (sort === this.current.sort) return; this.publish({ sort, page: 1 }); void this.load(); }
  toggleFavorites() { this.publish({ favoritesOnly: !this.current.favoritesOnly, page: 1 }); void this.load(); }
  clearFilters() { this.publish({ kind: 'all', searchInput: '', query: '', sort: 'newest', favoritesOnly: false, page: 1 }); void this.load(); }
  refresh(silent = false) { return this.load(silent); }
  poll() { if (!this.platform.hidden()) void this.load(true); }

  async load(silent = false) {
    if (this.disposed) return;
    const token = this.scope.capture();
    this.inflight?.abort(); this.inflight = null;
    if (!token.userId) { this.publish({ owner: null, list: null, loading: false, error: null }); return; }
    const controller = new AbortController(); this.inflight = controller;
    if (!silent) this.publish({ loading: true, error: null });
    try {
      const list = await this.platform.fetchWorks(controller.signal, this.filters());
      if (controller.signal.aborted) return;
      this.scope.assertCurrent(token);
      this.publish({ owner: token.userId, list, loading: false, error: null });
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.publish({ loading: false, error: cause instanceof Error ? cause.message : '作品读取失败。' });
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  async toggleFavorite(item: WorkItem) {
    if (this.disposed || this.current.favoriteBusy) return;
    const token = this.scope.capture();
    if (!token.userId) return;
    const controller = new AbortController(); this.favorite = controller;
    this.publish({ favoriteBusy: item.id });
    try {
      const result = await this.platform.setFavorite(controller.signal, item.id, !item.favorite, token.userId);
      if (controller.signal.aborted) return;
      this.scope.assertCurrent(token);
      const list = this.current.list;
      if (list) this.publish({ list: { ...list, items: list.items.map((value) => value.id === result.id ? result : value) } });
      this.platform.notify(this.platform.translate(result.favorite ? '已加入收藏，可通过“仅看收藏”找到它。' : '已取消收藏，作品仍保留在全部作品中。'), 'success');
      await this.load(true);
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.platform.notify(this.platform.translate(cause instanceof Error ? cause.message : '收藏状态未能更新。'), 'error');
    } finally {
      if (this.favorite === controller) { this.favorite = null; this.publish({ favoriteBusy: null }); }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort(); this.stopIdentity(); this.listeners.clear();
  }
}
