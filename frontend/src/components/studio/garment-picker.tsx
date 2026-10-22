'use client';

import { useRef, useState } from 'react';
import { SAMPLES, type useGarmentInput } from '@/hooks/use-garment-input';
import type { SessionSnapshot } from '@/lib/try-on/types';
import { Icon } from './icon';
import styles from './studio.module.css';

export function GarmentPicker({ snapshot, input, onConsent, onPrivacy }: {
  snapshot: SessionSnapshot; input: ReturnType<typeof useGarmentInput>; onConsent: (value: boolean) => void; onPrivacy: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const garment = snapshot.garment;
  return <section className={`${styles['garment-panel']} ${styles.panel}`} aria-labelledby="garment-title">
    <div className={styles['section-heading']}><h2 id="garment-title">选一张参考图</h2><Icon name="hanger" /></div>
    <p className={styles['section-description']}>当前体验：实时换装，从一件上衣开始。</p>
    <input ref={file} className={styles['visually-hidden']} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label="选择服装参考图" onChange={(event) => { void input.upload(event.target.files?.[0]); event.target.value = ''; }} />
    <button className={`${styles['upload-zone']} ${garment ? styles['has-image'] : ''} ${dragging ? styles['drag-over'] : ''}`} type="button" aria-label="上传或替换参考图" aria-describedby="file-help" onClick={() => file.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void input.upload(event.dataTransfer.files[0]); }}>
      {!garment ? <span className={styles['upload-empty']}><span className={styles['upload-icon']}><Icon name="upload" /></span><strong>上传服装参考图</strong><span>点击选择，或将灵感拖到这里</span></span> : <span className={styles['garment-preview']}>
        {garment.sampleId ? <svg viewBox="0 0 200 210" role="img" aria-label={garment.name}><use href={garment.previewUrl} /></svg> : <img src={garment.previewUrl} alt="所选服装参考图" />}
        <span className={styles['replace-label']}><Icon name="switch" />更换参考图</span>
      </span>}
    </button>
    <div className={styles['upload-meta']}><span id="file-help">JPG、PNG、WebP · 最大10MB</span>{garment && <button className={styles['text-button']} onClick={input.clear} type="button">移除</button>}</div>
    {input.processing && <p role="status" className={styles['section-description']}>正在本地处理参考图，原有图片保持可用。<button type="button" className={styles['text-button']} onClick={input.cancel}>取消处理</button></p>}
    {input.error && <p className={styles['inline-error']} role="alert">{input.error}</p>}
    <div className={styles['sample-heading']}><span>也可以从这些灵感试起</span><span className={styles['mini-label']}>示意素材</span></div>
    <div className={styles['sample-grid']} role="group" aria-label="选择换装灵感">{SAMPLES.map((item) => <button className={styles['sample-card']} key={item.id} type="button" aria-label={`选择${item.name}`} aria-pressed={garment?.sampleId === item.id} onClick={() => input.sample(item.id)}><span className={`${styles['sample-art']} ${styles[item.tone] ?? ''}`}><svg viewBox="0 0 200 210" aria-hidden="true"><use href={`/assets/garments.svg#${item.id}`} /></svg></span><span>{item.name}</span><span className={styles['sample-selected']} aria-hidden="true">✓</span></button>)}</div>
    <div className={styles['consent-block']}><label className={styles['consent-label']}><input type="checkbox" checked={snapshot.consent} onChange={(event) => onConsent(event.target.checked)} /><span>我已了解：当前相机与参考图仅在本地预览；生成画面为模拟，不上传、不录制。</span></label><button className={`${styles['text-button']} ${styles['consent-details']}`} type="button" onClick={onPrivacy}>了解画面如何处理 ↗</button></div>
    <p className={styles['privacy-note']}><Icon name="lock" />不采集音频 · 不默认录制你的画面</p>
  </section>;
}
