'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { notify } from '@/lib/notices';
import type { AccountView } from '@/lib/account';
import s from './site.module.css';

export type SitePage = 'home' | 'pricing' | 'studio' | 'account' | 'privacy' | 'works' | 'help' | 'terms';

const ACCOUNT_NAV = [
  ['/account', '个人中心', '权益概览'],
  ['/account/usage', '使用记录', '最近 20 条'],
  ['/account/orders', '我的订单', '订单记录'],
  ['/account/security', '账号设置', '登录与密码'],
] as const;

export function SiteHeader({ active, account, onLogin, onLogout }: { active: SitePage; account: AccountView | null; onLogin: () => void; onLogout: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [closing, setClosing] = useState(false), [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; caret: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const openMenu = () => { clearTimer(); setClosing(false); setOpen(true); };
  const closeMenu = (animate = true) => {
    setOpen(false);
    if (!animate) { clearTimer(); setClosing(false); return; }
    setClosing(true); clearTimer();
    // 保留 160ms 让退出动画播放完再卸载。
    timer.current = setTimeout(() => { setClosing(false); timer.current = null; }, 160);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const wrapper = menu.current, element = trigger.current;
      if (!wrapper || !element) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const viewport = window.innerWidth;
      const width = Math.min(210, viewport - 28);
      const edge = 14;
      const center = rect.left + rect.width / 2;
      // 优先对齐按钮中心；靠近窗口边缘时只向内侧收，保证菜单不溢出。
      const left = Math.min(Math.max(edge, center - width / 2), viewport - width - edge);
      setPosition({ left: left - wrapperRect.left, top: rect.bottom - wrapperRect.top + 12, caret: center - left - 5 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) closeMenu(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMenu(); trigger.current?.focus(); } };
    const scroll = () => closeMenu(false);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll); };
  }, [open]);
  const signout = async () => {
    if (busy) return;
    setBusy(true);
    try { await onLogout(); closeMenu(false); } catch { notify('退出未完成，请稍后重试。', 'error'); } finally { setBusy(false); }
  };
  const current = (href: string) => href === '/account' ? pathname === '/account' : pathname === href;
  return <header className={s.header}><div className={s.headerInner}>
    <Link href="/" className={s.brand} aria-label="映想首页">映想<span aria-hidden="true">✳</span></Link>
    <nav className={s.navigation} aria-label="主导航">{[
      ['home', '/', '首页'], ['studio', '/studio', '创作空间'], ['works', '/works', '我的作品'], ['pricing', '/pricing', '价格方案'], ['help', '/help', '帮助中心'],
    ].map(([page, href, label]) => <Link key={page} href={href} prefetch={false} className={active === page ? s.navActive : undefined} aria-current={active === page ? 'page' : undefined}>{label}</Link>)}</nav>
    <div className={s.headerActions}>{!account ? <span className={s.accountPending} role="status" aria-label="正在读取账号">账号读取中…</span> : account.user ? <div ref={menu} className={s.accountMenu}>
      <button ref={trigger} type="button" className={`${s.accountLink} ${s.accountTrigger}`} aria-label="账号菜单" aria-expanded={open} aria-controls={menuId} onClick={() => open ? closeMenu() : openMenu()}><span className={s.avatarDot}>{account.user.username[0].toUpperCase()}</span><span>个人中心</span><span className={s.chevron} aria-hidden="true"><svg viewBox="0 0 12 8" fill="none"><path d="M1.5 1.5 6 6l4.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span></button>
      {(open || closing) && position && <div className={`${s.accountPopover} ${closing ? s.accountPopoverClosing : ''}`} style={{ left: position.left, top: position.top, '--caret-left': `${position.caret}px` } as CSSProperties} aria-hidden={closing || undefined}>
        <div className={s.accountPopoverHead}><span className={s.avatarDot} aria-hidden="true">{account.user.username[0].toUpperCase()}</span><div><strong title={account.user.username}>{account.user.username}</strong><small>已登录 · 映想</small></div></div>
        <nav id={menuId} className={s.accountNav} aria-label="账号导航">
          {ACCOUNT_NAV.map(([href, label, note]) => <Link key={href} href={href} prefetch={false} aria-label={label} aria-current={current(href) ? 'page' : undefined} className={s.accountItem} onClick={() => closeMenu(false)}><span className={s.accountItemText}><strong>{label}</strong><small>{note}</small></span><span className={s.accountItemArrow} aria-hidden="true">↗</span></Link>)}
        </nav>
        <button type="button" className={s.accountSignout} disabled={busy} onClick={() => void signout()}>{busy ? '正在退出…' : '退出登录'}<span aria-hidden="true">→</span></button>
      </div>}
    </div> : <button type="button" className={s.loginButton} onClick={onLogin}>登录 / 注册</button>}</div>
  </div></header>;
}
