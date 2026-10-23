import Link from 'next/link';
import { ACTIVE_PHASES, type SessionSnapshot, type View } from '@/lib/try-on/types';
import { DURATION_OPTIONS, durationLabel, type DurationSec } from '@/lib/studio/policy';
import type { CameraPreviewState } from '@/lib/media/camera-preview-session';
import type { LocalCamera } from '@/lib/media/local-camera';
import type { RemotePreview } from '@/lib/media/remote-preview';
import { Icon } from './icon';
import { CameraPreview } from './camera-preview';
import styles from './studio.module.css';

export function PreviewPanel({ snapshot, view, camera, stream, previewState, remote, remoteStream, unavailable, processing, checking, loggedIn, exhausted, remaining, onStart, onStop, onCameraToggle, onView, onDuration, onConsent, onPrivacy, onChoose }: {
  snapshot: SessionSnapshot; view: View; camera: LocalCamera; stream: MediaStream | null; previewState: CameraPreviewState; remote: RemotePreview; remoteStream: MediaStream | null;
  unavailable: string | null; processing: boolean; checking: boolean; loggedIn: boolean; exhausted: boolean; remaining: number;
  onStart: () => void; onStop: () => void; onCameraToggle: () => void; onView: (view: View) => void; onDuration: (seconds: DurationSec) => void; onConsent: (value: boolean) => void; onPrivacy: () => void; onChoose: () => void;
}) {
  const active = ACTIVE_PHASES.has(snapshot.phase);
  const live = snapshot.phase === 'live' || snapshot.phase === 'updatingGarment';
  const generated = view === 'generated';
  const showRemote = generated && live && !!remoteStream;
  const cameraReady = previewState.phase === 'ready';
  const requesting = previewState.phase === 'requesting';
  const validImage = Boolean(snapshot.garment?.blob);
  const time = `${String(Math.floor(snapshot.remainingSeconds / 60)).padStart(2, '0')}:${String(snapshot.remainingSeconds % 60).padStart(2, '0')}`;
  const cloudReady = cameraReady && validImage && !processing && !unavailable && !exhausted;
  const status = active ? live ? '换装中' : '连接中' : requesting ? '等待相机' : cameraReady ? '相机已开启' : '相机未开启';
  return <section id="preview" className={`${styles['mirror-panel']} ${styles.panel} ${styles['compact-mirror']}`} aria-label="相机与映想画面">
    <div className={styles['mirror-heading']}><h2>画面</h2><span className={styles['session-status']} role="status"><span className={`${styles['status-dot']} ${!stream ? styles.neutral : ''}`} />{status}</span></div>
    <div className={styles['duration-bar']}><span>本次时长</span><div role="group" aria-label="每次换装时长">{DURATION_OPTIONS.map((seconds) => <button type="button" key={seconds} disabled={active || checking} aria-pressed={snapshot.durationSec === seconds} onClick={() => onDuration(seconds)}>{durationLabel(seconds)}</button>)}</div><span className={styles['duration-note']}>{active ? '含建连 · 换衣不续时' : snapshot.durationSec === 15 ? '免费体验' : loggedIn && remaining > 0 ? `可用${remaining}次` : '需对应权益'}</span></div>
    <div className={`${styles['mirror-stage']} ${styles['preview-frame']}`} data-state={snapshot.phase}>
      {stream ? <CameraPreview stream={stream} camera={camera} visible={!showRemote} /> : <div className={styles['camera-empty']}><Icon name="camera" /><p>{requesting ? '等待相机授权…' : '打开相机，先看看自己。'}</p></div>}
      {remoteStream && <CameraPreview stream={remoteStream} camera={remote} visible={showRemote} remote />}
      <div className={styles['preview-badges']}><span>{showRemote ? 'AI 生成' : stream ? '相机原画' : '本地相机'}</span>{active && snapshot.deadlineAt !== null && <span className={styles.timer} aria-label="换装剩余时间">{time}</span>}</div>
      {generated && !showRemote && <div className={`${styles['floating-card']} ${active ? styles['floating-connecting'] : ''}`} aria-label={active ? '正在连接换装' : '开启映想换装'}>
        <span className={styles['imagine-orbit']} aria-hidden="true">✳</span>
        {active ? <><h3>正在连接映想…</h3><span className={styles['connection-sweep']} aria-hidden="true" /><button type="button" className={styles['text-button']} onClick={onStop}>取消连接</button></>
          : !cameraReady ? <><h3>{requesting ? '相机准备中…' : '先打开相机'}</h3><button type="button" className={styles['primary-button']} disabled={requesting} onClick={onCameraToggle}><Icon name="camera" />{requesting ? '等待授权' : '打开相机'}</button></>
          : !validImage ? <><h3>选一件，换个新感觉。</h3><button type="button" className={styles['primary-button']} disabled={processing} onClick={onChoose}><Icon name="upload" />{processing ? '图片处理中…' : '选择上衣图'}</button></>
          : exhausted ? <><h3>{snapshot.phase === 'error' ? '本次连接已停止' : snapshot.durationSec === 15 ? '15秒体验次数已用完' : `暂无${durationLabel(snapshot.durationSec)}权益`}</h3><Link href="/account" prefetch={false} className={styles['floating-link']}>查看我的权益 ↗</Link>{snapshot.durationSec !== 15 && <Link href="/pricing" className={styles['text-button']}>查看方案 · 购买暂未开放 ↗</Link>}</>
          : <><h3>让想象，进入画面。</h3><label className={styles['floating-consent']}><input type="checkbox" checked={snapshot.consent} onChange={(event) => onConsent(event.target.checked)} /><span>我已获授权，同意图片与视频由 Decart 云端处理</span></label><button type="button" className={styles['primary-button']} disabled={!cloudReady || !snapshot.consent || checking} onClick={onStart}><span aria-hidden="true">✳</span>{checking ? '正在验证…' : loggedIn ? '开始换装' : '登录并体验'}<Icon name="arrow" /></button><div className={styles['floating-meta']}><span>{snapshot.durationSec === 15 ? '免费 · ' : ''}最多{durationLabel(snapshot.durationSec)}{remaining > 1 ? ` · 剩余${remaining}次` : ''}</span><button type="button" className={styles['text-button']} onClick={onPrivacy}>详情 ↗</button></div></>}
        {!active && validImage && cameraReady && unavailable && !exhausted && <details className={styles['floating-error']}><summary>换装服务暂未就绪</summary><p>{unavailable}</p></details>}
        {!active && snapshot.phase === 'error' && snapshot.message && <details className={styles['floating-error']}><summary>连接未完成，查看详情</summary><p>{snapshot.message}</p></details>}
      </div>}
    </div>
    <div className={styles['preview-controls']}><div className={styles['view-switch']} role="group" aria-label="画面切换"><button type="button" aria-pressed={!generated} className={!generated ? styles.selected : ''} onClick={() => onView('original')}>相机原画</button><button type="button" aria-pressed={generated} className={generated ? styles.selected : ''} onClick={() => onView('generated')}>映想画面 <span aria-hidden="true">✳</span></button></div>
      <div className={styles['preview-actions']}>{active && <button type="button" className={styles['stop-button']} onClick={onStop}><span className={styles['stop-square']} />结束换装</button>}<button type="button" className={styles['camera-button']} aria-pressed={Boolean(stream) || requesting} onClick={onCameraToggle}><Icon name="camera" />{requesting ? '取消打开' : stream ? '关闭相机' : '打开相机'}</button></div>
    </div>
    {previewState.message && <p className={styles['camera-error']} role="alert">{previewState.message}</p>}
  </section>;
}
