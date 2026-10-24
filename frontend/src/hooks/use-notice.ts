'use client';
import { useEffect } from 'react';
import { notify, type NoticeKind } from '@/lib/notices';
export function useNotice(message: string | null | undefined, kind: NoticeKind = 'error') {
  useEffect(() => { if (message) notify(message, kind); }, [message, kind]);
}
