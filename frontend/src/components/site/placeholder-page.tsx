'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { SiteShell } from './site-shell';
import type { SitePage } from './site-header';
import s from './placeholder-page.module.css';

export function PlaceholderPage({ title, active, feedback = false, description = '这一页的内容正在整理，完成后会在这里更新。' }: { title: string; active: SitePage; feedback?: boolean; description?: string }) {
  const { t } = useI18n();
  return <SiteShell active={active}><main className={s.page}>
    <header><h1>{t(title)}</h1>{feedback && <Link href="/help/feedback" prefetch={false}>{t("问题反馈 ↗")}</Link>}</header>
    <section className={s.empty} aria-label={t(`${title}占位`)}>
      <span className={`${s.star} star-hover-spin`} aria-hidden="true">✳</span>
      <h2>{t("这一页，还在准备。")}</h2>
      <p>{t(description)}<br />{t("在此之前，可以先进入创作空间，或查看价格与使用说明。")}</p>
      <div className={s.actions}>
        <Link href="/studio" prefetch={false} className={s.primary}>{t("进入创作空间 ")}<span aria-hidden="true">↗</span></Link>
        <Link href="/pricing">{t("价格方案")}</Link>
        <Link href="/privacy">{t("隐私与使用说明")}</Link>
      </div>
    </section>
  </main></SiteShell>;
}
