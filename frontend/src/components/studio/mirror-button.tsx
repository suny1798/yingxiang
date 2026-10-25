'use client';

import { useI18n } from '@/components/preferences';
import { Icon } from './icon';
import s from './preview-action.module.css';

export function MirrorButton({ mirrored, onToggle, disabled = false }: { mirrored: boolean; onToggle: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <button type="button" data-mirror-control data-preview-action className={s.button} aria-label={t("视频镜像")} aria-pressed={mirrored} disabled={disabled} title={t(mirrored ? '镜像已开启，点击关闭' : '镜像已关闭，点击开启')} onClick={onToggle}><Icon name="mirror" /><span>{t("镜像")}</span></button>;
}
