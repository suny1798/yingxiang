'use client';

import Link from 'next/link';
import type { AccountView } from '@/lib/account';
import s from './site.module.css';

export type SitePage = 'home' | 'pricing' | 'studio' | 'account';
export function SiteHeader({ active, account, onLogin }: { active: SitePage; account: AccountView | null; onLogin: () => void }) {
  return <header className={s.header}><div className={s.headerInner}>
    <Link href="/" className={s.brand} aria-label="映想首页">映想<span aria-hidden="true">✳</span></Link>
    <nav className={s.navigation} aria-label="主导航">{[
      ['home', '/', '首页'], ['pricing', '/pricing', '价格方案'], ['studio', '/studio', '创作空间'],
    ].map(([page, href, label]) => <Link key={page} href={href} prefetch={false} className={active === page ? s.navActive : undefined} aria-current={active === page ? 'page' : undefined}>{label}</Link>)}</nav>
    <div className={s.headerActions}>{account?.user ? <Link href="/account" prefetch={false} className={s.accountLink} aria-current={active === 'account' ? 'page' : undefined}><span className={s.avatarDot}>{account.user.username[0].toUpperCase()}</span><span>个人中心</span></Link> : <button type="button" className={s.loginButton} onClick={onLogin}>登录 / 注册</button>}</div>
  </div></header>;
}
