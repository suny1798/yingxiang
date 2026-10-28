import { onUnmounted,shallowRef } from 'vue';
import { captureVideoFrame,downloadVideoFrame } from '../lib/media/video-frame';
import { notify } from '../lib/notices';
import { LocalFrameTools,type FrameHost } from './frame-tools';
import { t } from './preferences';
import { sessionScope } from './runtime';

const browserHost: FrameHost = {
  get hidden() { return document.hidden; },
  get fullscreenEnabled() { return Boolean(document.fullscreenEnabled); },
  get fullscreenElement() { return document.fullscreenElement; },
  requestFullscreen: (element) => element.requestFullscreen(),
  exitFullscreen: () => document.exitFullscreen(),
  onFullscreenChange(listener) { document.addEventListener('fullscreenchange', listener); return () => document.removeEventListener('fullscreenchange', listener); },
  onHidden(listener) { document.addEventListener('visibilitychange', listener); return () => document.removeEventListener('visibilitychange', listener); },
  onPageHide(listener) { window.addEventListener('pagehide', listener); return () => window.removeEventListener('pagehide', listener); },
};

/** Vue只桥接页面操作；流、视频元素与导出结果仍由页面拥有，不进入store。 */
export function useFrameTools(options: { stage: () => HTMLElement | null; video: () => HTMLVideoElement | null; stem: () => string; mirrored?: boolean }) {
  const tools = new LocalFrameTools(browserHost, {
    capture: (video, mirrored) => captureVideoFrame(video, mirrored),
    download: (blob, filename) => downloadVideoFrame(blob, filename),
    stamp: () => new Date().toISOString().replace(/[:.]/g, '-'),
    notify: (message, kind) => notify(message, kind),
    translate: t,
  }, { ...options, scope: sessionScope });
  const snapshot = shallowRef(tools.getSnapshot());
  const stop = tools.subscribe(() => { snapshot.value = tools.getSnapshot(); });
  onUnmounted(() => { stop(); tools.dispose(); });
  return { snapshot, toggleMirror: () => tools.toggleMirror(), toggleFullscreen: () => void tools.toggleFullscreen(), capture: () => void tools.capture(), cancel: () => tools.cancel() };
}
