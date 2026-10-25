'use client';

import { useI18n } from '@/components/preferences';
import { MirrorButton } from './mirror-button';
import { PreviewSurface } from './preview-surface';
import { useEffect, useState } from 'react';
import { useOrientedDownload } from '@/hooks/use-oriented-download';
import { useGeneratedRecording } from '@/hooks/use-generated-recording';
import Link from 'next/link';
import { useNotice } from '@/hooks/use-notice';
import { notify } from '@/lib/notices';
import { ACTIVE_PHASES, type SessionSnapshot, type View } from '@/lib/try-on/types';
import { DURATION_OPTIONS, durationLabel, type DurationSec } from '@/lib/studio/policy';
import type { CameraPreviewState } from '@/lib/media/camera-preview-session';
import type { LocalCamera } from '@/lib/media/local-camera';
import type { RemotePreview } from '@/lib/media/remote-preview';
import { Icon } from './icon';
import { CameraPreview } from './camera-preview';
import styles from './studio.module.css';

export function PreviewPanel({ snapshot, view, camera, stream, previewState, remote, remoteStream, unavailable, processing, checking, loggedIn, exhausted, remaining, onStart, onStop, onCameraToggle, onView, onDuration, onConsent, onChoose, owner }: {
  owner: string | null; snapshot: SessionSnapshot; view: View; camera: LocalCamera; stream: MediaStream | null; previewState: CameraPreviewState; remote: RemotePreview; remoteStream: MediaStream | null;
  unavailable: string | null; processing: boolean; checking: boolean; loggedIn: boolean; exhausted: boolean; remaining: number;
  onStart: () => void; onStop: () => void; onCameraToggle: () => void; onView: (view: View) => void; onDuration: (seconds: DurationSec) => void; onConsent: (value: boolean) => void; onChoose: () => void;
}) {
  const { t } = useI18n();
  const [mirrored, setMirrored] = useState(true);
  const [saveVideo, setSaveVideo] = useState(false);
  const [replay, setReplay] = useState(false);
  const [originalHintDismissed, setOriginalHintDismissed] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const selectView = (next: View) => {
    setReplay(false);
    if (next === 'original') setOriginalHintDismissed(false);
    else setSetupDismissed(false);
    onView(next);
  };
  useNotice(previewState.message);
  const active = ACTIVE_PHASES.has(snapshot.phase);
  const live = snapshot.phase === 'live' || snapshot.phase === 'updatingGarment';
  const { recording, clearRecording } = useGeneratedRecording({ enabled: saveVideo, live, stream: remoteStream, session: snapshot.deadlineAt, seconds: snapshot.durationSec, owner });
  const orientedDownload = useOrientedDownload(recording.url, '映想-实时换装', owner);
  useEffect(() => { if (active) setReplay(false); else setSaveVideo(false); }, [active]);
  useEffect(() => { if (recording.phase === 'ready') setReplay(true); }, [recording.phase]);
  useNotice(recording.message);
  useEffect(() => { if (recording.phase === 'ready') notify('视频已准备好，可回放或下载。关闭页面前请保存。', 'success'); }, [recording.phase]);
  const showReplay = !active && replay && !!recording.url;
  const generated = view === 'generated';
  const showRemote = generated && live && !!remoteStream;
  const cameraReady = previewState.phase === 'ready';
  const requesting = previewState.phase === 'requesting';
  const validImage = Boolean(snapshot.garment?.blob);
  const time = `${String(Math.floor(snapshot.remainingSeconds / 60)).padStart(2, '0')}:${String(snapshot.remainingSeconds % 60).padStart(2, '0')}`;
  const cloudReady = cameraReady && validImage && !processing && !unavailable && !exhausted;
  const status = active ? live ? '换装中' : '连接中' : requesting ? '等待相机' : cameraReady ? '相机已开启' : '相机未开启';
  // 相机已开、还停在原画：引导用户切到映想画面，后续选图、确认、开始都在那里
  const viewHint = Boolean(stream) && cameraReady && !generated && !active;
  return <PreviewSurface><section data-workspace-preview id="preview" className={`${styles['mirror-panel']} ${styles.panel} ${styles['compact-mirror']}`} aria-label={t("相机与映想画面")}>
    <div data-preview-heading className={styles['mirror-heading']}><h2>{t("画面")}</h2><span className={styles['session-status']} role="status"><span className={`${styles['status-dot']} ${!stream ? styles.neutral : ''}`} />{t(status)}</span></div>
    <div data-preview-toolbar className={styles['duration-bar']}><span>{t("本次时长")}</span><div role="group" aria-label={t("每次换装时长")}>{DURATION_OPTIONS.map((seconds) => <button type="button" key={seconds} disabled={active || checking} aria-pressed={snapshot.durationSec === seconds} onClick={() => onDuration(seconds)}>{t(durationLabel(seconds))}</button>)}</div><span className={styles['duration-note']}>{t(active ? snapshot.deadlineAt === null ? '连接中 · 出画后计时' : '出画后计时 · 换衣不续时' : snapshot.durationSec === 15 ? '免费体验' : loggedIn && remaining > 0 ? `可用${remaining}次` : '需对应权益')}</span></div>
    <div data-preview-viewport className={styles['preview-viewport']}><div data-preview-stage className={`${styles['mirror-stage']} ${styles['preview-frame']}`} data-state={snapshot.phase}>
      {stream ? <CameraPreview stream={stream} camera={camera} visible={!showRemote && !showReplay} mirrored={mirrored} /> : <div className={styles['camera-empty']}>
        {/* 示意动画：演示换衣过程，不是实际生成结果 */}
        <video className={styles['demo-video']} autoPlay muted loop playsInline preload="auto" poster="/assets/try-on-demo-poster.jpg" aria-hidden="true">
          <source src="/assets/try-on-demo.webm" type="video/webm" />
          <source src="/assets/try-on-demo.mp4" type="video/mp4" />
        </video>
        <img className={styles['demo-poster']} src="/assets/try-on-demo-poster.jpg" alt="" aria-hidden="true" />
        {!generated && !showReplay && !originalHintDismissed && <div className={styles['demo-prompt']}>
          <button type="button" className={styles['hint-close']} aria-label={t("关闭相机使用提示")} onClick={() => setOriginalHintDismissed(true)}><Icon name="close" /></button>
          <p><strong>{t(requesting ? '等待相机授权…' : '打开相机，换上你选的服装')}</strong><span>{t("上方为示意动画，不是实际生成效果")}</span></p>
          <button type="button" className={styles['primary-button']} disabled={requesting} onClick={onCameraToggle}><Icon name="camera" />{t(requesting ? '等待授权' : '打开相机')}</button>
        </div>}
      </div>}
      {showReplay && <video data-mirrored={mirrored} className={styles['camera-video']} src={recording.url!} controls playsInline aria-label={t("本次换装视频回放")} />}
      {viewHint && !showReplay && !originalHintDismissed && <div className={styles['demo-prompt']}>
        <button type="button" className={styles['hint-close']} aria-label={t("关闭相机使用提示")} onClick={() => setOriginalHintDismissed(true)}><Icon name="close" /></button>
        <p><strong>{t("相机已开启，切到映想画面")}</strong><span>{t(validImage ? '服装已选好，在映想画面确认后开始换装' : '在映想画面选一件服装，开始换装')}</span></p>
        <button type="button" className={styles['primary-button']} onClick={() => selectView('generated')}><span aria-hidden="true">✳</span>{t("切到映想画面")}</button>
      </div>}
      {remoteStream && <CameraPreview stream={remoteStream} camera={remote} visible={showRemote} remote mirrored={mirrored} />}
      <div className={styles['preview-badges']}><span>{t(showReplay ? '本次换装回放' : showRemote ? 'AI 生成' : stream ? '相机原画' : '本地相机')}</span>{active && snapshot.deadlineAt !== null && <span className={styles.timer} aria-label={t("换装剩余时间")}>{t(time)}</span>}</div>
      {generated && !showRemote && !showReplay && (active || !setupDismissed) && <div className={`${styles['floating-card']} ${active ? styles['floating-connecting'] : !cameraReady || !validImage ? styles['floating-quick'] : ''}`} aria-label={t(active ? '正在连接换装' : '开启映想换装')}>
        {!active && <button type="button" className={styles['hint-close']} aria-label={t("关闭换装操作提示")} onClick={() => setSetupDismissed(true)}><Icon name="close" /></button>}
        <span className={styles['imagine-orbit']} aria-hidden="true">✳</span>
        {active ? <><h3>{t("正在连接映想…")}</h3><span className={styles['connection-sweep']} aria-hidden="true" /><button type="button" className={styles['text-button']} onClick={onStop}>{t("取消连接")}</button></>
          : !cameraReady ? <><h3>{t(requesting ? '相机准备中…' : '先打开相机')}</h3><button type="button" className={styles['primary-button']} disabled={requesting} onClick={onCameraToggle}><Icon name="camera" />{t(requesting ? '等待授权' : '打开相机')}</button></>
          : !validImage ? <><h3>{t("选件衣服，换个感觉")}</h3><button type="button" className={styles['primary-button']} disabled={processing} onClick={onChoose}><Icon name="upload" />{t(processing ? '处理中…' : '选服装')}</button></>
          : exhausted ? <><h3>{t(snapshot.phase === 'error' ? '本次连接已停止' : snapshot.durationSec === 15 ? '15秒体验次数已用完' : `暂无${durationLabel(snapshot.durationSec)}权益`)}</h3><Link href="/account" prefetch={false} className={styles['floating-link']}>{t("查看我的权益 ↗")}</Link>{snapshot.durationSec !== 15 && <Link href="/pricing" className={styles['text-button']}>{t("查看方案 · 购买暂未开放 ↗")}</Link>}</>
          : <><h3>{t("让想象，进入画面。")}</h3><label className={styles['floating-consent']}><input type="checkbox" checked={snapshot.consent} onChange={(event) => onConsent(event.target.checked)} /><span>{t("已获素材授权，同意云端处理")}</span></label><button type="button" className={styles['primary-button']} disabled={!cloudReady || !snapshot.consent || checking} onClick={onStart}><span aria-hidden="true">✳</span>{t(checking ? '正在验证…' : loggedIn ? '开始换装' : '登录并体验')}<Icon name="arrow" /></button><div className={styles['floating-meta']}><span>{t(snapshot.durationSec === 15 ? '免费 · ' : '')}{t("最多")}{t(durationLabel(snapshot.durationSec))}{t(remaining > 1 ? ` · 剩余${remaining}次` : '')}</span><Link href="/privacy#realtime" target="_blank" rel="noopener noreferrer">{t("隐私说明 ↗")}</Link></div></>}
        {!active && validImage && cameraReady && unavailable && !exhausted && <details className={styles['floating-error']}><summary>{t("换装服务暂未就绪")}</summary><p>{t(unavailable)}</p></details>}
        {!active && snapshot.phase === 'error' && snapshot.message && <details className={styles['floating-error']}><summary>{t("连接未完成，查看详情")}</summary><p>{t(snapshot.message)}</p></details>}
      </div>}
    </div></div>
    <div data-preview-controls className={styles['preview-controls']}><div className={styles['view-switch']} role="group" aria-label={t("画面切换")}><button type="button" aria-pressed={!generated} className={!generated ? styles.selected : ''} onClick={() => selectView('original')}>{t("相机原画")}</button><button type="button" aria-pressed={generated} className={generated ? styles.selected : viewHint ? styles['view-hint'] : ''} onClick={() => selectView('generated')}>{t("映想画面 ")}<span aria-hidden="true">✳</span></button></div>
      <div className={styles['preview-actions']}>{active && <button type="button" className={styles['stop-button']} onClick={onStop}><span className={styles['stop-square']} />{t("结束换装")}</button>}<MirrorButton mirrored={mirrored} disabled={orientedDownload.busy} onToggle={() => setMirrored((value) => !value)} /><button type="button" className={styles['camera-button']} aria-pressed={Boolean(stream) || requesting} onClick={onCameraToggle}><Icon name="camera" />{t(requesting ? '取消打开' : stream ? '关闭相机' : '打开相机')}</button></div>
    </div>
    <div data-preview-details className={styles['recording-bar']}>
      <label className={styles['record-toggle']}><input type="checkbox" title={t("开始前勾选，结束后可下载")} checked={saveVideo} disabled={active || checking || recording.phase === 'stopping'} onChange={(event) => setSaveVideo(event.target.checked)} /><span><strong>{t("保存本次生成视频")}</strong><small>{t("结束后可回放或下载")}</small></span></label>
      <span role="status">{t(recording.phase === 'recording' ? '正在保存生成画面…' : recording.phase === 'preparing' || recording.phase === 'stopping' ? '正在准备视频…' : recording.message ?? (recording.url ? '关闭或刷新页面前请下载' : ''))}</span>
      {recording.url && <div><button type="button" aria-pressed={showReplay} onClick={() => setReplay((value) => !value)}>{t(showReplay ? '返回实时画面' : '回放视频')}</button><button type="button" className={styles['download-button']} onClick={() => orientedDownload.busy ? orientedDownload.cancel() : void orientedDownload.download(mirrored)}>{t(orientedDownload.busy ? '取消导出' : '下载视频 ↓')}</button><button type="button" onClick={() => { setReplay(false); clearRecording(); notify('本次录像已清除。', 'success'); }}>{t("清除")}</button></div>}
      {!recording.url && !recording.message && recording.phase === 'idle' && <span className={styles['record-hint']}>{t("仅保存映想画面 · 不采集音频")}</span>}
    </div>
    {previewState.message && <p className={styles['camera-error']} role="alert">{t(previewState.message)}</p>}
  </section></PreviewSurface>;
}
