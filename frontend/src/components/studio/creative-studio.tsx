'use client';

import { useCallback, useState } from 'react';
import { useGarmentInput } from '@/hooks/use-garment-input';
import { useTryOnSession } from '@/hooks/use-try-on-session';
import { ACTIVE_PHASES, type Garment, type Scenario } from '@/lib/try-on/types';
import { GarmentPicker } from './garment-picker';
import { PreviewPanel } from './preview-panel';
import { InfoDialog, type DialogKind } from './info-dialog';
import { Icon } from './icon';
import styles from './studio.module.css';

export function CreativeStudio() {
  const { controller, snapshot, camera, stream, cameraEnabled, changeCameraEnabled } = useTryOnSession();
  const onGarment = useCallback((garment: Garment | null) => controller.setGarment(garment), [controller]);
  const input = useGarmentInput(onGarment);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const active = ACTIVE_PHASES.has(snapshot.phase);
  const start = () => {
    if (input.processing) return;
    void controller.start();
    if (window.matchMedia('(max-width: 620px)').matches) document.getElementById('preview')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  };
  return <div className={styles.studio} data-session-active={active} onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
    <header className={styles['site-header']}><div className={styles['header-inner']}><a className={styles.wordmark} href="/" aria-label="映想首页">映想<span className={styles['brand-dot']} aria-hidden="true">✳</span></a><nav aria-label="主导航"><a className={`${styles['nav-link']} ${styles.active}`} href="#creative-space" aria-current="page">创作空间</a><button className={styles['nav-link']} type="button" onClick={() => setDialog('guide')}>体验指南 ↗</button></nav><button className={styles.invitation} type="button" onClick={() => setDialog('invite')}><span className={styles['status-dot']} />受邀体验<Icon name="arrow" /></button></div></header>
    <main id="creative-space" className={styles['page-shell']}>
      <section className={styles.intro} aria-labelledby="page-title"><div><p className={styles.eyebrow}>映想 · 实时画面创作</p><h1 id="page-title">让想象，<span>在眼前发生。</span></h1></div><p className={styles['intro-copy']}>从实时换装开始，探索画面的更多可能。<br /><span>提示词创作、室内背景、宠物与摆件等场景规划中。</span></p></section>
      <div className={styles.workspace}><GarmentPicker snapshot={snapshot} input={input} onConsent={(value) => controller.setConsent(value)} onPrivacy={() => setDialog('privacy')} /><PreviewPanel snapshot={snapshot} camera={camera} stream={stream} cameraEnabled={cameraEnabled} processing={input.processing} onCameraMode={(enabled) => { input.cancel(); changeCameraEnabled(enabled); }} onStart={start} onStop={() => controller.stop()} onView={(view) => controller.setView(view)} /></div>
      <section className={styles['gentle-guide']} aria-label="让灵感更好地呈现"><p><Icon name="hanger" /><span>清晰参考，轻松开始</span></p><p><Icon name="sun" /><span>自然光线，画面更清楚</span></p><p><Icon name="close" /><span>随时结束，由你决定</span></p></section>
      <footer className={styles['page-footer']}><span>映想 <span className={styles['footer-dot']}>·</span> 让想象，在眼前发生。</span><div><button className={styles['text-button']} type="button" onClick={() => setDialog('privacy')}>画面与隐私</button><span>当前换装场景仅作视觉展示，不提供尺码建议</span></div></footer>
    </main>
    <aside className={styles['review-bar']} aria-label="模拟模式工具"><span className={styles['prototype-badge']}>映想 · 本地 Mock</span><p>{cameraEnabled ? '相机仅本地预览；AI画面为模拟。不上传、不录制。' : '仅模拟流程：不开相机，不上传，不生成视频。'}</p><details className={styles['scenario-menu']}><summary>预览体验状态 ⌃</summary><div className={styles['scenario-options']}><label htmlFor="scenario">下次开启时模拟</label><select id="scenario" value={snapshot.scenario} onChange={(event) => controller.setScenario(event.target.value as Scenario)}><option value="normal">正常体验流程</option><option value="camera-denied">相机权限被拒绝</option><option value="capacity">体验人数暂满</option><option value="quota">今日体验次数已用完</option><option value="connection-error">连接暂时失败</option></select><button className={styles['scenario-action']} type="button" disabled={snapshot.phase !== 'live'} onClick={() => { void controller.reconnect(); }}>演示连接中断</button><button className={styles['scenario-action']} type="button" onClick={() => { input.clear(); controller.reset(); }}>重新体验</button></div></details></aside>
    <InfoDialog kind={dialog} onClose={() => setDialog(null)} />
  </div>;
}
