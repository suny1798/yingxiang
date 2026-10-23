'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { SessionController } from '@/lib/try-on/session-controller';
import { LocalCamera } from '@/lib/media/local-camera';
import { CameraPreviewSession } from '@/lib/media/camera-preview-session';
import { RemotePreview } from '@/lib/media/remote-preview';
import { DecartTryOnAdapter, prepareRealtimeSdk, safeSdkDiagnostic } from '@/lib/try-on/decart-adapter';
import { STUDIO_POLICY, type StudioStatus } from '@/lib/studio/policy';
import { ACTIVE_PHASES } from '@/lib/try-on/types';

export function useTryOnSession() {
  const [camera] = useState(() => new LocalCamera());
  const [preview] = useState(() => new CameraPreviewSession(camera));
  const [remote] = useState(() => new RemotePreview());
  const [controller] = useState(() => new SessionController(new DecartTryOnAdapter(camera, remote, undefined, undefined, { keepLocalPreview: true }), { durationMs: STUDIO_POLICY.clientWindowSec * 1000 }));
  const stream = useSyncExternalStore(camera.subscribe, camera.getSnapshot, camera.getServerSnapshot);
  const previewState = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const remoteStream = useSyncExternalStore(remote.subscribe, remote.getSnapshot, remote.getServerSnapshot);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const inactive = !ACTIVE_PHASES.has(snapshot.phase);
  useEffect(() => {
    if (!inactive) return;
    const abort = new AbortController();
    void fetch('/api/studio/status', { cache: 'no-store', signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const value = await response.json() as StudioStatus;
      if (!abort.signal.aborted) { setStatus(value); setReadinessError(null); }
    }).catch(() => { if (!abort.signal.aborted) setReadinessError('暂时无法读取换装服务，请刷新页面。'); });
    return () => abort.abort();
  }, [inactive]);
  useEffect(() => {
    let current = true;
    void prepareRealtimeSdk(async () => { throw new Error('unauthorized: readiness check cannot dial'); }).then(() => {
      if (current) setSdkReady(true);
    }).catch((error: unknown) => { if (current) setSdkError(`换装组件未就绪（${safeSdkDiagnostic(error)}），请刷新页面。`); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!stream && !inactive) controller.stop('相机已关闭，换装随之结束。');
  }, [stream, inactive, controller]);
  useEffect(() => {
    const stopAll = () => { controller.stop('页面已离开前台，换装已结束。'); preview.stop(); };
    const onHidden = () => { if (document.hidden) stopAll(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', stopAll);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', stopAll); stopAll(); };
  }, [controller, preview]);
  const unavailable = sdkError ?? readinessError ?? (!status ? '换装服务准备中…' : !status.enabled ? '换装服务暂未启用。' : !status.keyConfigured ? '换装服务尚未配置完成。' : !sdkReady ? '换装组件准备中…' : !status.available ? '换装暂不可用。' : null);
  return { controller, snapshot, camera, stream, preview, previewState, remote, remoteStream, unavailable };
}
