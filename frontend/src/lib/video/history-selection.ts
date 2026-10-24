import type { VideoJobView } from './policy';

/** 刷新任务只更新用户已选记录，首次进入始终留在创作空态。 */
export function refreshVideoSelection(current: VideoJobView | null, jobs: VideoJobView[]): VideoJobView | null {
  if (!current) return null;
  const latest = jobs.find((job) => job.id === current.id);
  // 历史分页可以选中较早的记录，不因最近任务列表只含20条而切走。
  return latest ? { ...current, ...latest } : current;
}
