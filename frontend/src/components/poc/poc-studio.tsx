'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGarmentInput } from '@/hooks/use-garment-input';
import { LocalCamera } from '@/lib/media/local-camera';
import { RemotePreview } from '@/lib/media/remote-preview';
import { POC_POLICY, type PocStatus } from '@/lib/poc/policy';
import { DecartPocAdapter, preparePocSdk, safeSdkDiagnostic } from '@/lib/try-on/decart-poc-adapter';
import { SessionController } from '@/lib/try-on/session-controller';
import { ACTIVE_PHASES, PHASE_LABELS, type Garment } from '@/lib/try-on/types';
import { CameraPreview } from '../studio/camera-preview';
import styles from '../studio/studio.module.css';

export function PocStudio() {
  const [system] = useState(() => {
    const camera = new LocalCamera(), remote = new RemotePreview(), adapter = new DecartPocAdapter(camera, remote);
    return { camera, remote, adapter, controller: new SessionController(adapter, { durationMs: POC_POLICY.clientWindowSec * 1000 }) };
  });
  const { camera, remote, controller, adapter } = system;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const localStream = useSyncExternalStore(camera.subscribe, camera.getSnapshot, camera.getServerSnapshot);
  const remoteStream = useSyncExternalStore(remote.subscribe, remote.getSnapshot, remote.getServerSnapshot);
  const onImage = useCallback((image: Garment | null) => controller.setGarment(image), [controller]);
  const input = useGarmentInput(onImage), picker = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<PocStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [sdkState, setSdkState] = useState('正在准备模型组件');
  const [sdkReady, setSdkReady] = useState(false);
  const observing = snapshot.phase === 'live' || snapshot.phase === 'updatingGarment';
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/poc/status', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setStatus(await response.json() as PocStatus); setStatusError(null);
    } catch { setStatusError('无法读取本地测试状态，请确认服务已启动并使用本机地址。'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let current = true;
    // 只初始化客户端和固定模型定义，不申请相机、不签令牌、不建立供应商会话。
    void preparePocSdk(async () => { throw new Error('unauthorized: readiness check cannot dial'); }).then(() => {
      if (current) { setSdkReady(true); setSdkState('模型组件已就绪'); }
    }).catch((error: unknown) => { if (current) setSdkState(`模型组件初始化失败（${safeSdkDiagnostic(error)}），尚未调用模型。`); });
    return () => { current = false; };
  }, []);
  useEffect(() => { if (snapshot.phase === 'ended' || snapshot.phase === 'error') void refresh(); }, [snapshot.phase, refresh]);
  useEffect(() => {
    if (!observing) return;
    const timer = setTimeout(() => controller.stop('本轮短时观察已结束，请核对效果与供应商用量。'), 10_000);
    return () => clearTimeout(timer);
  }, [observing, controller]);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) controller.stop('页面已进入后台，本轮测试停止；请核对供应商用量。'); };
    const onLeave = () => controller.stop('页面已离开，本轮测试停止。');
    document.addEventListener('visibilitychange', onHidden); window.addEventListener('pagehide', onLeave);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', onLeave); controller.stop(); };
  }, [controller]);
  const active = ACTIVE_PHASES.has(snapshot.phase), live = snapshot.phase === 'live' || snapshot.phase === 'updatingGarment';
  const showOriginal = snapshot.view === 'original';
  const labels = { ...PHASE_LABELS, creatingSession: '正在准备短期访问资格', connecting: '正在连接真实模型', live: '远端视频已播放 · 请人工确认换装效果', updatingGarment: '新参考图已提交，等待画面变化' };
  const readyText = !status ? '正在读取本地状态…' : !status.enabled ? '真实验证入口尚未启用。' : !status.keyConfigured ? '请在服务端环境文件填写API Key，重启服务后刷新状态。' : !status.available ? '本轮令牌已签发或结果待核实。请先核对用量，不重复开始。' : '本轮可开始一次真实测试。';
  return <div className={styles.studio}>
    <header className={styles['site-header']}><div className={styles['header-inner']}><a className={styles.wordmark} href="/">映想<span className={styles['brand-dot']}>✳</span></a><a className={styles['text-button']} href="/">回到本地创作空间 ↗</a></div></header>
    <main className={styles['page-shell']}>
      <section className={styles.intro}><div><p className={styles.eyebrow}>映想 · 首次真实模型验证</p><h1>让参考图，<span>进入真实画面。</span></h1></div><p className={styles['intro-copy']}>本轮限一次短时连接 · 标准档<br />连接上限15秒，可能因建连而更短 · 不录制、不采集音频</p></section>
      <div className={styles.workspace}>
        <section className={`${styles['garment-panel']} ${styles.panel}`} aria-labelledby="poc-image-title">
          <div className={styles['section-heading']}><h2 id="poc-image-title">选择上衣参考图</h2></div>
          <p className={styles['section-description']}>请使用有权上传的清晰商品图。本轮不使用示意插画。</p>
          <input ref={picker} className={styles['visually-hidden']} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择真实测试参考图" tabIndex={-1} onChange={(event) => { void input.upload(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" className={styles['upload-zone']} aria-label="上传真实测试参考图" onClick={() => picker.current?.click()}>{snapshot.garment ? <span className={styles['garment-preview']}><img src={snapshot.garment.previewUrl} alt="本轮上衣参考图" /><span className={styles['replace-label']}>更换参考图</span></span> : <span>上传上衣参考图<br />JPG / PNG / WebP · 最大10MB</span>}</button>
          <div className={styles['upload-meta']}>{snapshot.garment && <button type="button" className={styles['text-button']} onClick={input.clear}>移除参考图</button>}{input.processing && <button type="button" className={styles['text-button']} onClick={input.cancel}>取消处理</button>}</div>
          {input.error && <p role="alert" className={styles['inline-error']}>{input.error}</p>}
          <div className={styles['consent-block']}><label className={styles['consent-label']}><input type="checkbox" checked={snapshot.consent} onChange={(event) => controller.setConsent(event.target.checked)} /><span>我同意本轮将参考图与相机视频发送至Decart云端，用于实时换装测试。我已确认图片使用权与参与者同意；不采集音频、不默认录制。</span></label></div>
          <p className={styles['privacy-note']}>云端测试与本地预览的数据处理不同。<a href="https://docs.platform.decart.ai/resources/privacy-policy" target="_blank" rel="noreferrer">查看供应商隐私说明 ↗</a></p>
        </section>
        <section className={`${styles['mirror-panel']} ${styles.panel}`} aria-labelledby="poc-preview-title">
          <div className={styles['mirror-heading']}><h2 id="poc-preview-title">真实换装验证</h2><span role="status" className={styles['session-status']}>{labels[snapshot.phase]}</span></div>
          <div className={styles['mirror-stage']}>
            {localStream && <CameraPreview stream={localStream} camera={camera} visible={showOriginal} />}
            {remoteStream && <CameraPreview stream={remoteStream} camera={remote} visible={!showOriginal} remote />}
            {!localStream && !remoteStream && <div className={styles['poc-empty']}><p>选择参考图、阅读说明后主动开启。</p><span>这里将显示相机原画与真实生成画面。</span></div>}
            <div className={styles['stage-topline']}><span className={styles['poc-chip']}>{showOriginal ? '本地相机原画' : 'AI生成画面 · 效果待确认'}</span>{active && snapshot.deadlineAt && <span className={styles.timer}>本地窗口 {snapshot.remainingSeconds}s</span>}</div>
            {active && !live && <div className={styles['stage-overlay']}><h3>{labels[snapshot.phase]}</h3><p>可以随时结束。本轮不自动重新建连。</p></div>}
          </div>
          <div className={styles['mirror-controls']}><div className={styles['view-switch']} role="group" aria-label="真实测试画面切换"><button type="button" disabled={!live || !remoteStream} aria-pressed={!showOriginal} onClick={() => controller.setView('generated')}>AI生成画面</button><button type="button" disabled={!localStream} aria-pressed={showOriginal} onClick={() => controller.setView('original')}>本地原画</button></div>
            {active ? <button type="button" className={styles['stop-button']} onClick={(event) => { if (event.detail < 2) controller.stop('你已结束本轮测试，请核对供应商用量。'); }}>结束本轮测试</button> : <button type="button" className={styles['primary-button']} disabled={!status?.available || !sdkReady || !snapshot.garment?.blob || !snapshot.consent || input.processing} onClick={() => { setStatus((current) => current ? { ...current, available: false } : current); void controller.start(); }}>开启一次真实测试</button>}
          </div>
          {snapshot.message && <p className={styles['poc-note']} role={snapshot.phase === 'error' ? 'alert' : 'status'}>{snapshot.message}</p>}
          <p className={styles['poc-note']}>{readyText}</p><button type="button" className={`${styles['text-button']} ${styles['poc-note']}`} disabled={active} onClick={() => { void refresh(); }}>刷新配置状态</button>
          <p className={styles['poc-note']} role={sdkReady ? 'status' : undefined}>{sdkState}</p>
          {statusError && <p role="alert" className={styles['inline-error']}>{statusError}</p>}
          {adapter.lastObservation && <p className={styles['poc-note']}>远端首帧：{adapter.lastObservation.firstFrameMs === null ? '未观察到' : `${adapter.lastObservation.firstFrameMs}ms`}；供应商事件秒数：{adapter.lastObservation.providerReportedSeconds ?? '未提供'}。这些观测不等同账单或服装效果验收。</p>}
        </section>
      </div>
      <p className={styles['poc-note']}>已批准模型测试预算最多$5；标准档公开费率$0.02/秒，单连接15秒估计$0.30。实际费用以供应商用量为准，令牌复用等边界仍待验证。不要重复刷新或重新开始付费测试。</p>
      <p className={styles['poc-note']}>模型 {POC_POLICY.model} · 本轮只签发一个短期令牌；失败、重启或刷新不会自动恢复测试额度。页面不保存媒体，只记录少量状态与耗时。</p>
    </main>
  </div>;
}
