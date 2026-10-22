'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { MockTryOnAdapter } from '@/lib/try-on/mock-adapter';
import { SessionController } from '@/lib/try-on/session-controller';
import { LocalCamera } from '@/lib/media/local-camera';
import { LocalPreviewAdapter } from '@/lib/try-on/local-preview-adapter';

export function useTryOnSession() {
  const [camera] = useState(() => new LocalCamera());
  const [localController] = useState(() => new SessionController(new LocalPreviewAdapter(camera)));
  const [mockController] = useState(() => new SessionController(new MockTryOnAdapter()));
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const controller = cameraEnabled ? localController : mockController;
  const stream = useSyncExternalStore(camera.subscribe, camera.getSnapshot, camera.getServerSnapshot);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) controller.stop('页面已离开前台，本次体验已结束。'); };
    const onLeave = () => controller.stop('你已离开创作空间，本次体验已结束。');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onLeave);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', onLeave); controller.stop(); };
  }, [controller]);
  function changeCameraEnabled(enabled: boolean) {
    if (enabled === cameraEnabled) return;
    const target = enabled ? localController : mockController;
    controller.stop('预览模式已切换，本次体验已结束。');
    target.reset();
    target.setGarment(snapshot.garment);
    // 更换数据处理模式后，重新阅读并确认说明。
    setCameraEnabled(enabled);
  }
  return { controller, snapshot, camera, stream, cameraEnabled, changeCameraEnabled };
}
