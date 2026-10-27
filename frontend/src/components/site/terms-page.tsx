'use client';

import Link from 'next/link';
import { useI18n } from '@/components/preferences';
import { SiteShell } from './site-shell';
import s from './support.module.css';

import { sections, type Copy } from '@/lib/public-terms';

export function TermsPage() {
  const { locale, t } = useI18n();
  const pick = (copy: Copy) => copy[locale === 'en' ? 1 : 0];
  return <SiteShell active="terms"><main className={s.page}>
    <header className={s.header}><p className={s.eyebrow}>{pick(['映想 · 服务条款', 'Yingxiang · Terms of service'])}</p><h1>{t('用户协议')}</h1><p>{pick(['本协议说明账号、素材、生成、支付与作品保存规则。', 'These terms explain the rules for accounts, materials, generation, payments, and saved creations.'])}</p><div className={s.meta}><span>{pick(['内测版 · v1.0', 'Test version · v1.0'])}</span><time dateTime="2026-10-27">2026-10-27</time></div></header>
    <div className={s.layout}><aside className={s.aside}><h2>{pick(['快速阅读', 'On this page'])}</h2><nav aria-label={pick(['协议目录', 'Terms contents'])}>{sections.map(section => <a key={section.id} href={`#${section.id}`}>{pick(section.title)}</a>)}</nav><Link href="/privacy">{t('隐私与使用说明')} ↗</Link><Link href="/help/feedback">{t('问题反馈')} ↗</Link></aside>
      <article className={s.panel}><div className={s.notice}><strong>{pick(['开始前，先知道这三件事', 'Three things to know before starting'])}</strong><p>{pick(['相机预览不等于上传；当前支付仅为沙盒；实时编辑仅向指定测试账号开放。实际生成需要另行确认，并受服务开放和账号权益限制。', 'Camera preview is not an upload. Payments are sandbox-only. Live editing is limited to designated test accounts. Generation requires a separate confirmation and is subject to availability and account entitlements.'])}</p></div>
        {sections.map(section => <section key={section.id} id={section.id} className={s.section}><h2>{pick(section.title)}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{pick(paragraph)}</p>)}</section>)}
        <div className={s.links}><Link href="/privacy">{t('隐私与使用说明')} ↗</Link><Link href="/help/feedback">{t('问题反馈')} ↗</Link><Link href="/pricing">{t('价格方案')} ↗</Link></div>
      </article>
    </div>
  </main></SiteShell>;
}
