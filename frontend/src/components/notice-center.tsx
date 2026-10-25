'use client';
import { useI18n } from '@/components/preferences';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { notices } from '@/lib/notices';
import s from './notice-center.module.css';

export function NoticeCenter() {
  const { t } = useI18n();
  const values = useSyncExternalStore(notices.subscribe, notices.getSnapshot, notices.getServerSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // 通知放入活动dialog，避免模态窗口将外部弹出通知标为inert。
    const update = () => setPortalTarget(document.querySelector<HTMLDialogElement>('dialog[open]') ?? document.body);
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element || !element.showPopover) return;
    try { if (element.matches(':popover-open')) element.hidePopover(); if (values.length) element.showPopover(); } catch { /* 保留固定浮层显示，不影响操作。 */ }
  }, [values, portalTarget]);
  if (!portalTarget) return null;
  return createPortal(<div ref={host} popover="manual" className={s.host} data-visible={!!values.length} aria-label={t("操作通知")}>
    {values.map((item) => <section key={item.id} className={s.notice} data-kind={item.kind} role={item.kind === 'error' ? 'alert' : 'status'} aria-live={item.kind === 'error' ? 'assertive' : 'polite'}>
      <span className={s.symbol} aria-hidden="true">{t(item.kind === 'error' ? '!' : item.kind === 'success' ? '✓' : item.kind === 'progress' ? '◷' : 'i')}</span>
      <div className={s.content}><strong>{t(item.kind === 'error' ? '操作未完成' : item.kind === 'success' ? '已完成' : item.kind === 'progress' ? '正在处理视频' : '提示')}</strong><p>{t(item.message)}</p>{item.kind === 'progress' && <><progress aria-label={t(item.label ?? '视频准备进度')} max={100} value={item.progress} /><span className={s.progressLabel}>{t(item.label)}{t(item.progress === undefined ? '' : ` ${Math.round(item.progress)}%`)}</span></>}</div>
      <button className={s.close} type="button" aria-label={t("关闭提示")} onClick={() => notices.dismiss(item.id)}>×</button>
    </section>)}
  </div>, portalTarget);
}
