'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { LocalCamera } from '@/lib/media/local-camera';
import { CameraPreviewSession } from '@/lib/media/camera-preview-session';
import { RemotePreview } from '@/lib/media/remote-preview';
import { safeSdkDiagnostic } from '@/lib/media/decart-realtime';
import { DecartPromptAdapter, preparePromptSdk } from '@/lib/prompt/adapter';
import { PromptSession, promptActive } from '@/lib/prompt/session';
import type { PromptStatus } from '@/lib/prompt/policy';

export function usePromptSession() {
  const [camera] = useState(() => new LocalCamera());
  const [preview] = useState(() => new CameraPreviewSession(camera));
  const [remote] = useState(() => new RemotePreview());
  const [controller] = useState(() => new PromptSession(new DecartPromptAdapter(camera, remote)));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const stream = useSyncExternalStore(camera.subscribe, camera.getSnapshot, camera.getServerSnapshot);
  const previewState = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const remoteStream = useSyncExternalStore(remote.subscribe, remote.getSnapshot, remote.getServerSnapshot);
  const [status, setStatus] = useState<PromptStatus | null>(null), [statusError, setStatusError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false), [sdkError, setSdkError] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/prompt/status', { cache: 'no-store', signal });
      if (!response.ok) throw new Error();
      const value = await response.json() as PromptStatus;
      if (!signal?.aborted) { setStatus({ available: value.available, message: value.message }); setStatusError(null); }
      return value;
    } catch { if (!signal?.aborted) setStatusError('暂时无法读取编辑服务，请刷新状态。'); return null; }
  }, []);
  const active = promptActive(snapshot.phase);
  useEffect(() => {
    if (active) return;
    const controller = new AbortController();
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    update(); const timer = setInterval(update, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, refresh]);
  useEffect(() => {
    let current = true;
    void preparePromptSdk(async () => { throw new Error('unauthorized: readiness cannot dial'); }).then(() => { if (current) setSdkReady(true); }).catch((error: unknown) => { if (current) setSdkError(`编辑组件未就绪（${safeSdkDiagnostic(error)}），请刷新页面。`); });
    return () => { current = false; };
  }, []);
  useEffect(() => { if (!stream && active) controller.stop('相机已关闭，实时编辑随之结束。'); }, [stream, active, controller]);
  useEffect(() => {
    const stopAll = () => { controller.stop('页面已离开前台，实时编辑已结束。'); preview.stop(); };
    const onHidden = () => { if (document.hidden) stopAll(); };
    document.addEventListener('visibilitychange', onHidden); window.addEventListener('pagehide', stopAll);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', stopAll); stopAll(); controller.dispose(); };
  }, [controller, preview]);
  return { camera, preview, remote, controller, snapshot, stream, previewState, remoteStream, status, refresh, sdkReady, unavailable: sdkError ?? statusError ?? (!status ? '编辑服务准备中…' : !sdkReady ? '编辑组件准备中…' : !status.available ? status.message : null) };
}
