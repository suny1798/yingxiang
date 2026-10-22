'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { MockTryOnAdapter } from '@/lib/try-on/mock-adapter';
import { SessionController } from '@/lib/try-on/session-controller';

export function useTryOnSession() {
  const [controller] = useState(() => new SessionController(new MockTryOnAdapter()));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) controller.stop('页面已离开前台，本次体验已结束。'); };
    const onLeave = () => controller.stop('你已离开创作空间，本次体验已结束。');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onLeave);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', onLeave); controller.stop(); };
  }, [controller]);
  return { controller, snapshot };
}
