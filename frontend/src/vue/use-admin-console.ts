import { onMounted,onUnmounted,shallowRef,watch,type Ref } from 'vue';
import { notify } from '../lib/notices';
import { accountCoordinator } from './runtime';
import { preferences } from './preferences';
import { AdminConsole,AdminRequestError,type AdminPlatform } from './admin';

/** 管理请求：GET/POST同源；错误消息直接取服务器提示，不自动重试。 */
export async function adminRequest<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch { throw new AdminRequestError('管理请求未完成。', 0); }
  let value: unknown;
  try { value = await response.json(); } catch { value = undefined; }
  if (!response.ok) throw new AdminRequestError((value as { error?: { message?: string } } | undefined)?.error?.message ?? '管理请求未完成。', response.status);
  return value as T;
}

export function useSay() {
  return (zh: string, en: string) => preferences.locale.value === 'en' ? en : zh;
}

export type AdminData<T> = Readonly<{ data: T | null; error: string; loading: boolean }>;

/** 每个面板只读取当前标签；卸载、切换标签或刷新版本时取消旧读取。 */
export function useAdminData<T>(path: () => string, revision: Ref<number>) {
  const state = shallowRef<AdminData<T>>({ data: null, error: '', loading: true });
  let controller: AbortController | undefined;
  const load = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    state.value = { data: null, error: '', loading: true };
    try {
      const data = await adminRequest<T>(path(), undefined, current.signal);
      if (!current.signal.aborted) state.value = { data, error: '', loading: false };
    } catch (error) {
      if (!current.signal.aborted) state.value = { data: null, error: error instanceof Error ? error.message : '管理请求未完成。', loading: false };
    }
  };
  onMounted(() => { void load(); });
  watch([path, revision], () => { void load(); });
  onUnmounted(() => { controller?.abort(); });
  return state;
}

const browserPlatform: AdminPlatform = {
  request: adminRequest,
  requestId: () => crypto.randomUUID(),
  notify: (message, kind) => notify(message, kind),
  savedMessage: () => preferences.locale.value === 'en' ? 'Changes saved and recorded in the audit log.' : '管理修改已保存并记录操作日志。',
  failedMessage: () => preferences.locale.value === 'en' ? 'The request could not be completed.' : '管理请求未完成。',
  refreshAccount: () => { void accountCoordinator.refresh(); },
};

/** 页面只接线订阅；写入确认、幂等、版本冲突与即时鉴权由AdminConsole处理。 */
export function useAdminConsole() {
  const admin = new AdminConsole(browserPlatform);
  const state = shallowRef(admin.getSnapshot());
  const stop = admin.subscribe(() => { state.value = admin.getSnapshot(); });
  onUnmounted(() => { stop(); admin.dispose(); });
  return { state, admin };
}
