import { ACTIVE_PHASES, PHASE_LABELS, type SessionSnapshot, type View } from '@/lib/try-on/types';
import { Icon } from './icon';
import styles from './studio.module.css';

const loading = {
  requestingCamera: ['先让画面准备好', '此处模拟相机授权，不会调用真实相机。'],
  creatingSession: ['为你的想象留个位置', '此处模拟体验资格检查，你可以随时结束。'],
  connecting: ['正在连接映想画面', '当前仅模拟连接流程，不请求真实模型。'],
  reconnecting: ['画面暂时离开了一下', '正在模拟恢复连接，体验时间继续计算。'],
} as const;

export function PreviewPanel({ snapshot, onStart, onStop, onView }: { snapshot: SessionSnapshot; onStart: () => void; onStop: () => void; onView: (view: View) => void }) {
  const active = ACTIVE_PHASES.has(snapshot.phase);
  const live = ['live', 'updatingGarment'].includes(snapshot.phase);
  const waiting = loading[snapshot.phase as keyof typeof loading];
  const overlay = waiting ?? (snapshot.phase === 'ended' ? ['这次想象，先到这里。', snapshot.message] : snapshot.phase === 'error' ? ['映想暂时没有准备好', snapshot.message] : null);
  const hint = snapshot.phase === 'error' ? snapshot.message : active ? snapshot.phase === 'updatingGarment' ? '新的灵感已提交，正在模拟更新画面。' : '当前仅演示界面；可对比画面或结束体验。' : !snapshot.garment ? '选一张服装参考图，让第一个灵感就位。' : !snapshot.consent ? '开启前，请了解并确认画面处理方式。' : '灵感已就位，点击「开启映想」体验界面流程。';
  const remaining = `${String(Math.floor(snapshot.remainingSeconds / 60)).padStart(2, '0')}:${String(snapshot.remainingSeconds % 60).padStart(2, '0')}`;
  return <section id="preview" className={`${styles['mirror-panel']} ${styles.panel}`} aria-labelledby="mirror-title">
    <div className={styles['mirror-heading']}><h2 id="mirror-title">画面预览 <span>当前场景 · 实时换装</span></h2><span className={styles['session-status']} role="status" aria-live="polite"><span className={`${styles['status-dot']} ${!live ? styles.neutral : ''}`} />{PHASE_LABELS[snapshot.phase]}</span></div>
    <div className={styles['mirror-stage']} data-state={snapshot.phase}>
      <div className={styles['stage-topline']}><span className={styles['stage-label']}><Icon name="camera" />{live ? '画面状态 · 模拟' : '相机未开启'}</span>{snapshot.deadlineAt !== null && active && <span className={styles.timer} aria-label="剩余体验时间">{remaining}</span>}</div>
      <span className={`${styles['mirror-stitch']} ${styles['top-left']}`} aria-hidden="true" /><span className={`${styles['mirror-stitch']} ${styles['bottom-right']}`} aria-hidden="true" />
      <div className={styles['studio-art']}><img src="/assets/fitting-room.svg" alt="映想换装场景的人台插画，仅作界面示意，不代表生成结果" draggable={false} /></div>
      <div className={styles['art-caption']}><span className={styles['caption-line']} /><span>给眼前的世界<br />一点新想象</span></div><span className={styles['illustration-label']}>创作示意 · 非生成结果</span>
      {overlay && <div className={styles['stage-overlay']}><div className={`${styles['overlay-icon']} ${waiting ? styles.spinning : ''}`}><Icon name={waiting ? 'camera' : snapshot.phase === 'ended' ? 'check' : 'info'} /></div><h3>{overlay[0]}</h3><p>{overlay[1]}</p></div>}
      {live && <div className={styles['view-label']}>{snapshot.view === 'generated' ? '映想画面' : '原始画面'} · 模拟</div>}
      <div className={styles['stage-bottomline']}><span>{live ? '可替换参考图；当前插画保持静态，不生成视频。' : '画面保持清晰，让上半身进入镜头。'}</span><span className={styles['sound-off']}>不采集音频</span></div>
    </div>
    <div className={styles['mirror-controls']}><div className={styles['view-switch']} role="group" aria-label="画面切换"><button type="button" disabled={!live} aria-pressed={snapshot.view === 'generated'} className={snapshot.view === 'generated' ? styles.selected : ''} onClick={() => onView('generated')}>映想画面</button><button type="button" disabled={!live} aria-pressed={snapshot.view === 'original'} className={snapshot.view === 'original' ? styles.selected : ''} onClick={() => onView('original')}>原始画面</button></div>
      <div className={styles['session-actions']}>{active ? <button type="button" className={styles['stop-button']} onClick={onStop}><span className={styles['stop-square']} />结束体验</button> : <button type="button" className={styles['primary-button']} disabled={!snapshot.garment || !snapshot.consent} onClick={onStart}><Icon name="camera" /><span>{['ended', 'error'].includes(snapshot.phase) ? '再次开启' : '开启映想'}</span><Icon name="arrow" className={styles.arrow} /></button>}</div>
    </div><div className={styles['control-note']}><p>{hint}</p><span>每次体验最多60秒</span></div>
  </section>;
}
