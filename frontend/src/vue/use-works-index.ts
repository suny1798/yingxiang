import { onMounted,onUnmounted,shallowRef } from 'vue';
import type { WorkItem,WorkPage } from '../lib/api-schema';
import { notify } from '../lib/notices';
import { t } from './preferences';
import { sessionScope } from './runtime';
import { WorksIndex,type WorksPlatform } from './works-index';

async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '作品暂时无法读取，请稍后重试。');
  return value as T;
}

const browserPlatform: WorksPlatform = {
  fetchWorks: async (signal, filters) => {
    const params = new URLSearchParams({ kind: filters.kind, page: String(filters.page), pageSize: '9', sort: filters.sort });
    if (filters.query) params.set('q', filters.query);
    if (filters.favoritesOnly) params.set('favorite', 'true');
    return json<WorkPage>(await fetch(`/api/works?${params}`, { cache: 'no-store', signal }));
  },
  setFavorite: async (signal, id, favorite, owner) => json<WorkItem>(await fetch(`/api/works/${id}`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Work-Owner': owner }, body: JSON.stringify({ favorite }),
  })),
  hidden: () => document.hidden,
  notify: (message, kind) => notify(message, kind),
  translate: t,
};

/** 页面只接线订阅与轮询事件；筛选、私有请求、账号世代与迟到结果由WorksIndex处理。 */
export function useWorksIndex() {
  const index = new WorksIndex(sessionScope, browserPlatform);
  const state = shallowRef(index.getSnapshot());
  const stop = index.subscribe(() => { state.value = index.getSnapshot(); });
  const poll = () => index.poll();
  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void index.refresh();
    timer = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    window.addEventListener('yingxiang:works-changed', poll);
  });
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', poll);
    window.removeEventListener('focus', poll);
    window.removeEventListener('yingxiang:works-changed', poll);
    stop(); index.dispose();
  });
  return { state, index };
}
