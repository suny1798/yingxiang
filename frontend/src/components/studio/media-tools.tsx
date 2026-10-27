'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useI18n } from '@/components/preferences';
import { captureVideoFrame, downloadVideoFrame } from '@/lib/media/video-frame';
import { notify } from '@/lib/notices';
import { Icon } from './icon';
import s from './media-tools.module.css';

type Props = {
  targetRef: RefObject<HTMLElement | null>;
  getVideo: () => HTMLVideoElement | null;
  mirrored: boolean;
  fileStem: string;
  disabled?: boolean;
};

export function MediaTools({ targetRef, getVideo, mirrored, fileStem, disabled = false }: Props) {
  const { t } = useI18n();
  const [supported, setSupported] = useState(false), [fullscreen, setFullscreen] = useState(false), [capturing, setCapturing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const update = () => setFullscreen(document.fullscreenElement === targetRef.current);
    setSupported(Boolean(document.fullscreenEnabled && targetRef.current?.requestFullscreen));
    document.addEventListener('fullscreenchange', update);
    return () => { mounted.current = false; document.removeEventListener('fullscreenchange', update); };
  }, [targetRef]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (targetRef.current?.requestFullscreen) await targetRef.current.requestFullscreen();
      else throw new Error('unsupported');
    } catch {
      notify(t('暂时无法切换全屏，请检查浏览器权限后重试。'), 'error');
    }
  };
  const capture = async () => {
    if (capturing || disabled) return;
    setCapturing(true);
    try {
      const blob = await captureVideoFrame(getVideo(), mirrored);
      if (!mounted.current) return;
      downloadVideoFrame(blob, `${fileStem}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      notify(t('已导出当前画面，截图仅保存在你选择的位置。'), 'success');
    } catch (cause) {
      if (mounted.current) notify(t(cause instanceof Error ? cause.message : '截图未完成，请稍后重试。'), 'error');
    } finally {
      if (mounted.current) setCapturing(false);
    }
  };
  return <div className={s.tools} aria-label={t('画面工具')}>
    <button type="button" aria-label={t(fullscreen ? '退出全屏' : '全屏观看')} title={t(!supported ? '当前浏览器不支持全屏，请尝试桌面 Chrome 或 Edge。' : fullscreen ? '退出全屏' : '全屏观看')} disabled={disabled || !supported} onClick={() => void toggleFullscreen()}><Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} /><span>{t(fullscreen ? '退出全屏' : '全屏')}</span></button>
    <button type="button" aria-label={t('保存当前帧')} title={t('保存当前帧为PNG')} disabled={disabled || capturing} onClick={() => void capture()}><Icon name="snapshot" /><span>{t(capturing ? '截图中' : '截图')}</span></button>
  </div>;
}
