import { ACTIVE_PHASES, PHASE_LABELS, type SessionSnapshot, type View } from '@/lib/try-on/types';
import { Icon } from './icon';
import styles from './studio.module.css';
import type { LocalCamera } from '@/lib/media/local-camera';
import { CameraPreview } from './camera-preview';

const loading = {
  requestingCamera: ['先让画面准备好', '此处模拟相机授权，不会调用真实相机。'],
  creatingSession: ['为你的想象留个位置', '此处模拟体验资格检查，你可以随时结束。'],
  connecting: ['正在连接映想画面', '当前仅模拟连接流程，不请求真实模型。'],
  reconnecting: ['画面暂时离开了一下', '正在模拟恢复连接，体验时间继续计算。'],
} as const;

export function PreviewPanel({ snapshot, camera, stream, cameraEnabled, processing, onCameraMode, onStart, onStop, onView }: { snapshot: SessionSnapshot; camera: LocalCamera; stream: MediaStream | null; cameraEnabled: boolean; processing: boolean; onCameraMode: (enabled: boolean) => void; onStart: () => void; onStop: () => void; onView: (view: View) => void }) {
  const active = ACTIVE_PHASES.has(snapshot.phase);
  const live = ['live', 'updatingGarment'].includes(snapshot.phase);
  const original = !!stream && snapshot.view === 'original';
  const waiting = snapshot.phase === 'requestingCamera' && cameraEnabled ? ['正在等待相机画面', '请在浏览器中允许相机。等待时可随时结束；不会申请麦克风。'] : loading[snapshot.phase as keyof typeof loading];
  const overlay = waiting ?? (snapshot.phase === 'ended' ? ['这次想象，先到这里。', snapshot.message] : snapshot.phase === 'error' ? ['映想暂时没有准备好', snapshot.message] : null);
  const hint = snapshot.phase === 'error' ? snapshot.message : processing ? '正在处理参考图，可以取消处理或等待完成。' : active ? snapshot.phase === 'updatingGarment' ? '新的参考图已在本地准备好；AI换装仍为模拟。' : cameraEnabled ? '相机画面仅在本地显示；切换到映想画面查看模拟示意。' : '当前仅演示界面；可切换画面或结束体验。' : !snapshot.garment ? '选一张服装参考图，让第一个灵感就位。' : !snapshot.consent ? '开启前，请了解并确认画面处理方式。' : cameraEnabled ? '点击「开启映想」申请相机权限，仅在本地预览。' : '灵感已就位，点击「开启映想」体验模拟流程。';
  const remaining = `${String(Math.floor(snapshot.remainingSeconds / 60)).padStart(2, '0')}:${String(snapshot.remainingSeconds % 60).padStart(2, '0')}`;
  return <section id="preview" className={`${styles['mirror-panel']} ${styles.panel}`} aria-labelledby="mirror-title">
    <div className={styles['mirror-heading']}><h2 id="mirror-title">画面预览 <span>当前场景 · 实时换装</span></h2><span className={styles['session-status']} role="status" aria-live="polite"><span className={`${styles['status-dot']} ${!live ? styles.neutral : ''}`} />{live && cameraEnabled ? '本地相机已就绪 · AI模拟' : PHASE_LABELS[snapshot.phase]}</span></div>
    <div className={styles['camera-mode']} role="group" aria-label="预览模式"><button type="button" aria-pressed={cameraEnabled} onClick={() => onCameraMode(true)}>真实相机预览</button><button type="button" aria-pressed={!cameraEnabled} onClick={() => onCameraMode(false)}>仅模拟流程</button><span>切换模式会结束体验并重置处理确认</span></div>
    <div className={styles['mirror-stage']} data-state={snapshot.phase}>
      <div className={styles['stage-topline']}><span className={styles['stage-label']}><Icon name="camera" />{stream ? '相机已开启 · 仅本地' : '相机未开启'}</span>{snapshot.deadlineAt !== null && active && <span className={styles.timer} aria-label="剩余体验时间">{remaining}</span>}</div>
      <span className={`${styles['mirror-stitch']} ${styles['top-left']}`} aria-hidden="true" /><span className={`${styles['mirror-stitch']} ${styles['bottom-right']}`} aria-hidden="true" />
      <div className={styles['studio-art']} aria-hidden={original}><img src="/assets/fitting-room.svg" alt="映想换装场景的人台插画，仅作界面示意，不代表生成结果" draggable={false} /></div>
      {stream && <CameraPreview stream={stream} camera={camera} visible={original} />}
      {!original && <><div className={styles['art-caption']}><span className={styles['caption-line']} /><span>给眼前的世界<br />一点新想象</span></div><span className={styles['illustration-label']}>创作示意 · 非生成结果</span></>}
      {overlay && <div className={styles['stage-overlay']} role={snapshot.phase === 'error' ? 'alert' : undefined}><div className={`${styles['overlay-icon']} ${waiting ? styles.spinning : ''}`}><Icon name={waiting ? 'camera' : snapshot.phase === 'ended' ? 'check' : 'info'} /></div><h3>{overlay[0]}</h3><p>{overlay[1]}</p></div>}
      {live && <div className={styles['view-label']}>{original ? '本地相机原画 · 未经AI处理' : '映想画面 · Mock模拟'}</div>}
      <div className={styles['stage-bottomline']}><span>{original ? '相机仅本地显示，不上传、不录制。' : live ? '当前插画为模拟示意，不生成换装视频。' : '画面保持清晰，让上半身进入镜头。'}</span><span className={styles['sound-off']}>不采集音频</span></div>
    </div>
    <div className={styles['mirror-controls']}><div className={styles['view-switch']} role="group" aria-label="画面切换"><button type="button" disabled={!live} aria-pressed={snapshot.view === 'generated'} className={snapshot.view === 'generated' ? styles.selected : ''} onClick={() => onView('generated')}>映想画面 · 模拟</button><button type="button" disabled={!live || !stream} aria-pressed={snapshot.view === 'original'} className={snapshot.view === 'original' ? styles.selected : ''} onClick={() => onView('original')}>本地原画</button></div>
      <div className={styles['session-actions']}>{active ? <button type="button" className={styles['stop-button']} onClick={(event) => { if (event.detail < 2) onStop(); }}><span className={styles['stop-square']} />结束体验</button> : <button type="button" className={styles['primary-button']} disabled={!snapshot.garment || !snapshot.consent || processing} onClick={onStart}><Icon name="camera" /><span>{['ended', 'error'].includes(snapshot.phase) ? '再次开启' : '开启映想'}</span><Icon name="arrow" className={styles.arrow} /></button>}</div>
    </div><div className={styles['control-note']}><p>{hint}</p><span>每次体验最多60秒</span></div>
  </section>;
}
