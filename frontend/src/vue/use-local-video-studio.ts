import { computed,onMounted,onUnmounted,shallowRef } from 'vue';
import { inspectVideo } from '../lib/video/mp4';
import { notify } from '../lib/notices';
import { LocalVideoMedia,type LocalVideoPlatform } from './local-video-studio';
import { t } from './preferences';
import { sessionScope } from './runtime';

const browserPlatform: LocalVideoPlatform = {
  read: async (file) => new Uint8Array(await file.arrayBuffer()),
  inspect: (bytes) => inspectVideo(bytes, { allowAudio: true }),
  createURL: (file) => URL.createObjectURL(file),
  revokeURL: (url) => URL.revokeObjectURL(url),
  notify: (message, kind) => notify(message, kind),
  translate: t,
};

// 只跨视频页与衣装灵感往返保留，刷新或离开该流程后清理。
let draft: LocalVideoMedia | null = null;
export function clearVideoDraft() { draft?.dispose(); draft = null; }

/** 本机素材可跨衣装选择返回；页面只管理订阅和预览元素。 */
export function useLocalVideoStudio() {
  const media = draft ??= new LocalVideoMedia(sessionScope, browserPlatform);
  const video = shallowRef(media.video.getSnapshot()), input = shallowRef(media.input.getSnapshot());
  const stops = [media.video.subscribe(() => { video.value = media.video.getSnapshot(); }), media.input.subscribe(() => { input.value = media.input.getSnapshot(); })];
  const selected = computed(() => input.value.garments.find((item) => item.id === input.value.selectedId) ?? null);
  const hidden = () => { if (document.hidden) media.hidden(); };
  onMounted(() => document.addEventListener('visibilitychange', hidden));
  onUnmounted(() => { document.removeEventListener('visibilitychange', hidden); stops.forEach((stop) => stop()); media.hidden(); });
  const allowed = () => !document.hidden && !sessionScope.state.transitioning && !sessionScope.state.blocked;
  const choose = (file?: File | null) => { if (allowed()) void media.video.choose(file ?? null); };
  const uploadImages = (files: readonly File[]) => { if (files.length && allowed()) void media.input.replace(files[0]); };
  return { media, video, input, selected, choose, uploadImages, remove: () => media.video.remove(), cancel: () => media.video.cancel() };
}
