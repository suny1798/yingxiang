'use client';

import { useI18n } from '@/components/preferences';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useNotice } from '@/hooks/use-notice';
import { notify } from '@/lib/notices';
import { SiteHeader } from '../site/site-header';
import { useAccount } from '@/hooks/use-account';
import { AccountDialog } from './account-dialog';
import { useGarmentInput } from '@/hooks/use-garment-input';
import { useTryOnSession } from '@/hooks/use-try-on-session';
import { ACTIVE_PHASES, type Garment, type View } from '@/lib/try-on/types';
import { GarmentPicker } from './garment-picker';
import { PreviewPanel } from './preview-panel';
import { StudioModes } from './studio-modes';
import styles from './studio.module.css';

export function CreativeStudio() {
  const { t } = useI18n();
  const { controller, snapshot, camera, stream, preview, previewState, remote, remoteStream, unavailable } = useTryOnSession();
  const onGarment = useCallback((garment: Garment | null) => controller.setGarment(garment), [controller]);
  const input = useGarmentInput(onGarment);
  const fileRef = useRef<HTMLInputElement>(null);
  useNotice(unavailable && !unavailable.includes('准备') && !unavailable.includes('读取') ? unavailable : null, 'info');
  const { account, error: accountError, refresh } = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<View>('original');
  const active = ACTIVE_PHASES.has(snapshot.phase);
  useNotice(snapshot.message, snapshot.phase === 'error' ? 'error' : 'info');
  useNotice(previewState.message);
  useEffect(() => { if (snapshot.phase === 'live') notify('换装画面已连接。', 'success'); }, [snapshot.phase]);
  const previousUser = useRef<string | null>(null);
  useEffect(() => { void refresh(); }, [active, refresh]);
  useEffect(() => {
    const next = account?.user?.id ?? null;
    if (previousUser.current && previousUser.current !== next) { controller.stop('登录状态已变化。'); preview.stop(); }
    previousUser.current = next;
  }, [account, controller, preview]);
  useEffect(() => { if (snapshot.phase === 'ended') setView('original'); }, [snapshot.phase]);
  const remaining = account?.durations.find((item) => item.seconds === snapshot.durationSec)?.remaining ?? 0;
  const exhausted = Boolean(account?.user) && remaining < 1;
  const start = async () => {
    if (checking || input.processing || unavailable || !snapshot.garment?.blob || !snapshot.consent || previewState.phase !== 'ready' || view !== 'generated') return;
    setChecking(true);
    try {
      const current = await refresh();
      if (!current || document.hidden) return;
      if (!current.user) { setAccountOpen(true); return; }
      if (!current.durations.some((item) => item.seconds === snapshot.durationSec && item.remaining > 0)) return;
      // 登录与读取权益都不会自动申请相机，原预览必须仍就绪。
      if (camera.isReady()) void controller.start();
    } finally { setChecking(false); }
  };
  const closeCamera = () => { controller.stop('相机已关闭。'); preview.stop(); setView('original'); };
  const logout = async () => { closeCamera(); const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); };
  return <div className={styles.studio} data-mode="realtime" data-session-active={active} onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
    <SiteHeader active="studio" account={account} onLogin={() => setAccountOpen(true)} onLogout={logout} />
    <main id="creative-space" className={`${styles['page-shell']} ${styles['creation-shell']}`}>
      <div className={styles['workbench-title']}><h1>{t("创作空间")}</h1><span>{t("实时换装")}</span><Link href="/account" prefetch={false}>{t(account?.user ? `剩余 ${account.durations.reduce((sum, item) => sum + item.remaining, 0)} 次` : '我的权益')} ↗</Link></div>
      <StudioModes active="realtime" />
      <div className={styles.workspace}>
        <GarmentPicker snapshot={snapshot} input={input} fileRef={fileRef} />
        <PreviewPanel key={account?.user?.id ?? 'guest'} owner={account?.user?.id ?? null} snapshot={snapshot} view={view} camera={camera} stream={stream} previewState={previewState} remote={remote} remoteStream={remoteStream}
          unavailable={accountError ?? (!account ? '账号读取中…' : unavailable)} processing={input.processing} checking={checking} loggedIn={Boolean(account?.user)} exhausted={exhausted} remaining={remaining}
          onStart={() => void start()} onStop={() => controller.stop()} onCameraToggle={() => { if (stream || previewState.phase === 'requesting') closeCamera(); else void preview.start(); }}
          onView={(value) => { setView(value); controller.setView(value); }} onDuration={(value) => controller.setDuration(value)} onConsent={(value) => controller.setConsent(value)} onChoose={() => fileRef.current?.click()} />
      </div>
      <footer className={styles['creation-footer']}><span /><Link href="/privacy#realtime" target="_blank" rel="noopener noreferrer">{t("隐私与使用说明 ↗")}</Link></footer>
    </main>
    {accountOpen && <AccountDialog account={account} onClose={() => setAccountOpen(false)} onChanged={async () => { await refresh(); setAccountOpen(false); }} onLogout={logout} />}
  </div>;
}
