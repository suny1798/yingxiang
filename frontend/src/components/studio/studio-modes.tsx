'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import s from './studio-modes.module.css';

export function StudioModes({ active }: { active: 'realtime' | 'video' | 'prompt' }) {
  const { t } = useI18n();
  return <nav className={s.modes} aria-label={t("创作模式")}>
    <Link prefetch={false} href="/studio" aria-current={active === 'realtime' ? 'page' : undefined}><span aria-hidden="true">◉</span>{t("实时换装")}</Link>
    <Link prefetch={false} href="/studio/video" aria-current={active === 'video' ? 'page' : undefined}><span aria-hidden="true">▷</span>{t("视频换装")}</Link>
    <Link prefetch={false} href="/studio/edit" aria-current={active === 'prompt' ? 'page' : undefined}><span aria-hidden="true">✳</span>{t("实时编辑")}</Link>
  </nav>;
}
