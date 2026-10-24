'use client';

import { useId, useRef, type ReactNode } from 'react';
import styles from './studio.module.css';

/** 辅助信息按需打开，避免挤占创作画面和主要操作。 */
export function WorkspaceInfo({ label, children }: { label: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return <>
    <button type="button" className={styles['workspace-info-trigger']} onClick={() => dialog.current?.showModal()}>{label} ↗</button>
    <dialog ref={dialog} className={styles['workspace-info']} aria-labelledby={title}>
      <div className={styles['dialog-heading']}><h2 id={title}>{label}</h2><button type="button" className={styles['icon-button']} aria-label="关闭面板" onClick={() => dialog.current?.close()}>×</button></div>
      {children}
    </dialog>
  </>;
}
