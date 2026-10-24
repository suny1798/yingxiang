'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useNotice } from './use-notice';
import { accountSession } from '@/lib/account-session';

export function useAccount() {
  const { account, error } = useSyncExternalStore(accountSession.subscribe, accountSession.getSnapshot, accountSession.getServerSnapshot);
  useNotice(error);
  useEffect(() => {
    const update = () => { if (!document.hidden) void accountSession.revalidate(); };
    update();
    const timer = setInterval(update, 10_000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  return { account, error, refresh: accountSession.refresh };
}
