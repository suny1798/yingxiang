'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './studio.module.css';
import { mountPreviewSurface } from '@/lib/media/preview-layout';

/** 三种业务共享的固定框架；只随窗口改变，不随内容、媒体或模式改变。 */
export function PreviewSurface({ children }: { children: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => mountPreviewSurface(slot.current), []);
  return <div ref={slot} className={styles['preview-slot']}>{children}</div>;
}
