'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useAccount } from '@/hooks/use-account';
import { AccountDialog } from '../studio/account-dialog';
import studioStyles from '../studio/studio.module.css';
import { SiteHeader, type SitePage } from './site-header';
import s from './site.module.css';

type AccountContext = ReturnType<typeof useAccount> & { openLogin: () => void; logout: () => Promise<void> };
const Context = createContext<AccountContext | null>(null);
export function useSiteAccount() { const value = useContext(Context); if (!value) throw new Error('缺少账号容器'); return value; }
export function SiteShell({ active, children }: { active: SitePage; children: ReactNode }) {
  const state = useAccount();
  const [open, setOpen] = useState(false);
  const logout = async () => {
    const response = await fetch('/api/account/logout', { method: 'POST' });
    if (!response.ok) throw new Error('退出未完成，请重试。');
    await state.refresh();
  };
  return <Context.Provider value={{ ...state, openLogin: () => setOpen(true), logout }}><div className={s.site}>
    <SiteHeader active={active} account={state.account} onLogin={() => setOpen(true)} />
    {children}
    <footer className={s.footer}><div><Link href="/" className={s.footerBrand}>映想 <span>✳</span></Link><p>让想象，在眼前发生。</p></div><nav aria-label="页脚导航"><Link href="/pricing">价格方案</Link><Link href="/studio" prefetch={false}>创作空间</Link><Link href="/account" prefetch={false}>个人中心</Link></nav><p className={s.footerNote}>从实时换装开始。<br />不采集音频，不默认录制。</p></footer>
    {open && <div className={studioStyles.studio} style={{ minHeight: 0, paddingBottom: 0 }}><AccountDialog account={state.account} onClose={() => setOpen(false)} onChanged={async () => { await state.refresh(); setOpen(false); }} onLogout={logout} /></div>}
  </div></Context.Provider>;
}
