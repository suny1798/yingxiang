'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountView } from '@/lib/account';

export function useAccount() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const operation = ++revision.current;
    try {
      const response = await fetch('/api/account/me', { cache: 'no-store' });
      if (!response.ok) throw new Error('暂时无法读取账号，请稍后重试。');
      const value = await response.json() as AccountView;
      if (revision.current === operation) { setAccount(value); setError(null); }
      return value;
    } catch (failure) {
      if (revision.current === operation) setError(failure instanceof Error ? failure.message : '账号暂不可用。');
      return null;
    }
  }, []);
  useEffect(() => {
    const update = () => { if (!document.hidden) void refresh(); };
    update();
    const timer = setInterval(update, 10_000);
    window.addEventListener('focus', update);
    return () => { ++revision.current; clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);
  return { account, error, refresh };
}
