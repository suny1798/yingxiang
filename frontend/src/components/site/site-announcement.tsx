'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/preferences';
import type { Announcement } from '@/lib/api-schema';
import s from './site.module.css';

export function SiteAnnouncement() {
  const { locale } = useI18n();
  const [value, setValue] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch('/api/site/announcement', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const next = await response.json() as Announcement;
          if (!controller.signal.aborted) setValue(current => !current || next.version >= current.version ? next : current);
        }
      } catch { /* 公告读取失败不影响原业务。 */ }
    };
    void read();
    window.addEventListener('focus', read);
    return () => { controller.abort(); window.removeEventListener('focus', read); };
  }, []);
  if (!value?.enabled || dismissed === value.version) return null;
  return <aside className={s.siteAnnouncement} role="status"><span>{locale === 'en' ? value.en : value.zh}</span><button type="button" onClick={() => setDismissed(value.version)} aria-label={locale === 'en' ? 'Dismiss announcement' : '关闭公告'}>×</button></aside>;
}
