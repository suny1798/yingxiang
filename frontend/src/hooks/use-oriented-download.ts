'use client';
import { useEffect, useRef, useState } from 'react';
import { orientVideo, readVideoBlob } from '@/lib/media/oriented-video';
import { notices, notify } from '@/lib/notices';

export function useOrientedDownload(source: string | null, filename: string, owner: string | null) {
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null), revision = useRef(0);
  const cached = useRef<{ source: string; blob: Blob } | null>(null), downloadUrl = useRef<string | null>(null);
  useEffect(() => {
    ++revision.current; operation.current?.abort(); operation.current = null; cached.current = null; setBusy(false);
    const stop = () => operation.current?.abort();
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop);
    return () => {
      ++revision.current; stop(); cached.current = null;
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null;
    };
  }, [source, owner]);
  const download = async (mirrored: boolean) => {
    if (!source || operation.current) return;
    const controller = new AbortController(), current = revision.current;
    operation.current = controller; setBusy(true);
    const notice = notices.show({ kind: 'progress', message: '正在准备与当前画面方向一致的视频。', label: '读取视频' });
    try {
      const blob = cached.current?.source === source ? cached.current.blob : await readVideoBlob(source, controller.signal, (percent) => notices.show({ id: notice, kind: 'progress', message: '正在读取已有视频，不会重新生成。', label: '下载视频', progress: percent }));
      controller.signal.throwIfAborted();
      if (revision.current !== current) return;
      cached.current = { source, blob };
      const result = await orientVideo(blob, mirrored, controller.signal, (percent) => notices.show({ id: notice, kind: 'progress', message: '正在按当前画面方向导出，请保持页面可见。', label: '导出视频', progress: percent }));
      controller.signal.throwIfAborted();
      if (revision.current !== current || document.hidden) return;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = URL.createObjectURL(result.blob);
      const link = document.createElement('a'); link.href = downloadUrl.current; link.download = `${filename}.${result.extension}`;
      document.body.append(link); link.click(); link.remove();
      notify('已发起下载，视频方向与当前画面一致。', 'success');
    } catch (cause) {
      if (revision.current === current) notify(controller.signal.aborted ? '已取消导出，视频仍可继续预览。' : cause instanceof Error ? cause.message : '视频导出未完成。', controller.signal.aborted ? 'info' : 'error');
    } finally {
      notices.dismiss(notice);
      if (operation.current === controller) { operation.current = null; if (revision.current === current) setBusy(false); }
    }
  };
  return { busy, download, cancel: () => operation.current?.abort() };
}
