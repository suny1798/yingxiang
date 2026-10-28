import { onMounted, onUnmounted, shallowRef } from 'vue';
import { inspectVideo } from '../lib/video/mp4';
import { prepareVideo } from '../lib/video/prepare';
import type { VideoJobView, VideoServiceView } from '../lib/video/policy';
import { notify } from '../lib/notices';
import { t } from './preferences';
import { sessionScope } from './runtime';
import { VideoJobs, type VideoJobsPlatform } from './video-jobs';

async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '操作未完成，请稍后重试。');
  return value as T;
}

const browserPlatform: VideoJobsPlatform = {
  fetchService: async (signal) => json<VideoServiceView>(await fetch('/api/video/jobs', { cache: 'no-store', signal })),
  fetchJob: async (signal, id) => json<VideoJobView>(await fetch(`/api/video/jobs/${id}`, { cache: 'no-store', signal })),
  submit: async (signal, input) => {
    const form = new FormData();
    form.set('data', input.file, 'person.mp4');
    form.set('reference_image', input.garment, 'garment.png');
    form.set('consentVersion', input.consentVersion);
    return json<VideoJobView>(await fetch('/api/video/jobs', { method: 'POST', headers: { 'X-Video-Attempt': input.attemptId }, body: form, cache: 'no-store', signal }));
  },
  prepare: (signal, file, onProgress) => prepareVideo(file, signal, onProgress),
  inspect: (bytes) => inspectVideo(bytes),
  hidden: () => document.hidden,
  notify: (message, kind) => notify(message, kind),
  translate: t,
};

/** 页面只接线订阅与轮询事件；账号世代、unknown恢复与清理由VideoJobs处理。 */
export function useVideoJobs() {
  const jobs = new VideoJobs(sessionScope, browserPlatform);
  const state = shallowRef(jobs.getSnapshot());
  const stop = jobs.subscribe(() => { state.value = jobs.getSnapshot(); });
  const poll = () => { void jobs.poll(); };
  const refresh = () => { void jobs.refresh(); };
  const visibility = () => { if (document.hidden) jobs.hidden(); else refresh(); };
  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void jobs.refresh();
    timer = setInterval(poll, 4000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', refresh);
  });
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('focus', refresh);
    stop(); jobs.dispose();
  });
  return { state, jobs };
}
