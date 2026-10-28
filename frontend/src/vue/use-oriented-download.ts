import { onMounted,onUnmounted,ref,watch } from 'vue';
import { orientVideo,readVideoBlob } from '../lib/media/oriented-video';
import { notices,notify } from '../lib/notices';
import { t } from './preferences';
import { sessionScope } from './runtime';

/** 下载按当前镜像重新编码；只读取已有结果，不重新生成。取消或换账号后迟到文件不落盘。 */
export function useOrientedDownload(source: () => string | null, filename: () => string, owner: () => string | null) {
  const busy = ref(false);
  let operation: AbortController | null = null, revision = 0, cached: { source: string; blob: Blob } | null = null, downloadUrl: string | null = null;
  const reset = () => { ++revision; operation?.abort(); operation = null; cached = null; busy.value = false; };
  watch([source, owner], reset);
  const stop = () => operation?.abort();
  const hidden = () => { if (document.hidden) stop(); };
  const stopIdentity = sessionScope.onIdentityChange(reset);
  onMounted(() => { document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop); });
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop);
    stopIdentity(); reset();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = null;
  });
  const download = async (mirrored: boolean) => {
    const url = source();
    if (!url || operation) return;
    const controller = new AbortController(), current = revision;
    operation = controller; busy.value = true;
    const notice = notices.show({ kind: 'progress', message: t('正在准备与当前画面方向一致的视频。'), label: t('读取视频') });
    try {
      const blob = cached?.source === url ? cached.blob : await readVideoBlob(url, controller.signal, (percent) => notices.show({ id: notice, kind: 'progress', message: t('正在读取已有视频，不会重新生成。'), label: t('下载视频'), progress: percent }));
      controller.signal.throwIfAborted();
      if (revision !== current) return;
      cached = { source: url, blob };
      const result = await orientVideo(blob, mirrored, controller.signal, (percent) => notices.show({ id: notice, kind: 'progress', message: t('正在按当前画面方向导出，请保持页面可见。'), label: t('导出视频'), progress: percent }));
      controller.signal.throwIfAborted();
      if (revision !== current || document.hidden) return;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = downloadUrl; link.download = `${filename()}.${result.extension}`;
      document.body.append(link); link.click(); link.remove();
      notify(t('已发起下载，视频方向与当前画面一致。'), 'success');
    } catch (cause) {
      if (revision === current) notify(controller.signal.aborted ? t('已取消导出，视频仍可继续预览。') : t(cause instanceof Error ? cause.message : '视频导出未完成。'), controller.signal.aborted ? 'info' : 'error');
    } finally {
      notices.dismiss(notice);
      if (operation === controller) { operation = null; if (revision === current) busy.value = false; }
    }
  };
  return { busy, download: (mirrored: boolean) => void download(mirrored), cancel: () => operation?.abort() };
}
