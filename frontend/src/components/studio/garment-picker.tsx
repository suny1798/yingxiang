'use client';

import { useI18n } from '@/components/preferences';
import { useState, type RefObject } from 'react';
import { type useGarmentInput } from '@/hooks/use-garment-input';
import type { SessionSnapshot } from '@/lib/try-on/types';
import { MAX_GARMENTS } from '@/lib/limits';
import { Icon } from './icon';
import styles from './studio.module.css';

export function GarmentPicker({ snapshot, input, fileRef }: {
  snapshot: SessionSnapshot; input: ReturnType<typeof useGarmentInput>; fileRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const garment = snapshot.garment;
  const full = input.garments.length >= MAX_GARMENTS;
  return <section className={`${styles['garment-panel']} ${styles.panel} ${styles['compact-picker']}`} aria-labelledby="garment-title">
    <div className={styles['section-heading']}><h2 id="garment-title">{t("服装参考图")}</h2><span className={styles['wardrobe-count']}>{input.garments.length} / {MAX_GARMENTS}</span></div>
    <input ref={fileRef} className={styles['visually-hidden']} type="file" multiple accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label={t("选择服装参考图，可多选")} onChange={(event) => { void input.uploadMany(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <button className={`${styles['upload-zone']} ${garment ? styles['has-image'] : ''} ${dragging ? styles['drag-over'] : ''}`} type="button" aria-label={t("添加服装参考图")} aria-describedby="file-help" onClick={() => fileRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void input.uploadMany(Array.from(event.dataTransfer.files)); }}>
      {!garment ? <span className={styles['upload-empty']}><img className={styles['upload-sample']} src="/assets/garment-sample.svg" alt="" aria-hidden="true" /><span className={styles['upload-icon']}><Icon name="upload" /></span><strong>{t("点击或拖入多张图片")}</strong><span>{t("平铺或挂拍的服装图效果更好")}</span></span> : <span className={styles['garment-preview']}><img src={garment.previewUrl} alt={t("当前选中的服装参考图")} /><span className={styles['replace-label']}><Icon name="upload" />{t(full ? '已满6张' : '添加图片')}</span></span>}
    </button>
    <div className={styles['upload-meta']}><span id="file-help">{t("JPG / PNG / WebP · 每张≤10MB")}</span></div>
    {input.garments.length > 0 && <>
      <div className={styles['wardrobe-grid']} role="group" aria-label={t("服装参考图，点击切换")}>
        {input.garments.map((item, index) => <div className={styles['wardrobe-item']} key={item.id}>
          <button type="button" className={styles['wardrobe-choice']} aria-label={`${t('选择服装')} ${index + 1}: ${item.name}`} aria-pressed={input.selectedId === item.id} title={item.name} onClick={() => input.select(item.id)}>
            <img src={item.previewUrl} alt="" /><span>{t(String(index + 1).padStart(2, '0'))}</span>
          </button>
          <button type="button" className={styles['wardrobe-remove']} aria-label={`${t('移除服装')} ${index + 1}: ${item.name}`} onClick={() => input.remove(item.id)}>×</button>
        </div>)}
        {!full && <button type="button" className={styles['wardrobe-add']} aria-label={t("继续添加服装图片")} onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>{t("添加")}</span></button>}
      </div>
      <p className={styles['wardrobe-hint']} aria-live="polite">{t(snapshot.phase === 'updatingGarment' ? '正在切换参考图…' : '点击缩略图，切换服装')}</p>
    </>}
    {input.processing && <p role="status" className={styles['section-description']}>{t("图片处理中… ")}<button type="button" className={styles['text-button']} onClick={input.cancel}>{t("取消")}</button></p>}
    {input.error && <p className={styles['inline-error']} role="alert">{t(input.error)}</p>}
  </section>;
}
