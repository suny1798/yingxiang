export type NoticeKind = 'error' | 'success' | 'info' | 'progress';
export interface Notice { id: string; kind: NoticeKind; message: string; progress?: number; label?: string }
const empty: Notice[] = [];
export class NoticeStore {
  private values = empty;
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private next = 0;
  getSnapshot = () => this.values;
  getServerSnapshot = () => empty;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(values: Notice[]) { this.values = values; this.listeners.forEach((listener) => listener()); }
  dismiss = (id: string) => { clearTimeout(this.timers.get(id)); this.timers.delete(id); this.publish(this.values.filter((item) => item.id !== id)); };
  show(value: Omit<Notice, 'id'> & { id?: string }) {
    const previous = value.id ? this.values.find((item) => item.id === value.id) : this.values.find((item) => item.message === value.message && item.kind === value.kind);
    const id = value.id ?? previous?.id ?? `notice-${++this.next}`;
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const notice = { ...value, id };
    const values = [...this.values.filter((item) => item.id !== id), notice];
    while (values.length > 3) { const removed = values.shift()!; clearTimeout(this.timers.get(removed.id)); this.timers.delete(removed.id); }
    this.publish(values);
    // 处理中的进度保留到任务结束；完成型通知均自动收起。
    if (value.kind !== 'progress') this.timers.set(id, setTimeout(() => this.dismiss(id), value.kind === 'error' ? 7000 : 4500));
    return id;
  }
}
export const notices = new NoticeStore();
export const notify = (message: string, kind: NoticeKind = 'info') => notices.show({ message, kind });
