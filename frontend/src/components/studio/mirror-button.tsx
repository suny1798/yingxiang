import { Icon } from './icon';
import s from './preview-action.module.css';

export function MirrorButton({ mirrored, onToggle, disabled = false }: { mirrored: boolean; onToggle: () => void; disabled?: boolean }) {
  return <button type="button" data-mirror-control data-preview-action className={s.button} aria-label="视频镜像" aria-pressed={mirrored} disabled={disabled} title={mirrored ? '镜像已开启，点击关闭' : '镜像已关闭，点击开启'} onClick={onToggle}><Icon name="mirror" /><span>镜像</span></button>;
}
