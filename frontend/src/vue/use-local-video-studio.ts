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

/** Vue只桥接本机视频与参考图；URL、Blob和视频元素仍由页面拥有。 */
export function useLocalVideoStudio() {
  const media = new LocalVideoMedia(sessionScope, browserPlatform);
  const video = shallowRef(media.video.getSnapshot()), input = shallowRef(media.input.getSnapshot());
  const stops = [media.video.subscribe(() => { video.value = media.video.getSnapshot(); }), media.input.subscribe(() => { input.value = media.input.getSnapshot(); })];
  const selected = computed(() => input.value.garments.find((item) => item.id === input.value.selectedId) ?? null);
  const hidden = () => { if (document.hidden) media.hidden(); };
  onMounted(() => document.addEventListener('visibilitychange', hidden));
  onUnmounted(() => { document.removeEventListener('visibilitychange', hidden); stops.forEach((stop) => stop()); media.dispose(); });
  const allowed = () => !document.hidden && !sessionScope.state.transitioning && !sessionScope.state.blocked;
  const choose = (file?: File | null) => { if (allowed()) void media.video.choose(file ?? null); };
  const uploadImages = (files: readonly File[]) => { if (files.length && allowed()) void media.input.uploadMany(files); };
  return { media, video, input, selected, choose, uploadImages, remove: () => media.video.remove(), cancel: () => media.video.cancel() };
}
