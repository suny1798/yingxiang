'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { LocalCamera } from '@/lib/media/local-camera';
import styles from './studio.module.css';
import { useI18n } from '@/components/preferences';

export function CameraPreview({ stream, camera, visible, remote = false, mirrored = !remote, videoRef: forwardedRef }: { stream: MediaStream; camera: Pick<LocalCamera, 'markPlaying' | 'playbackFailed'>; visible: boolean; remote?: boolean; mirrored?: boolean; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const { t } = useI18n();
  const localRef = useRef<HTMLVideoElement>(null), video = forwardedRef ?? localRef;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = true;
    element.srcObject = stream;
    void element.play().catch(() => { if (current) camera.playbackFailed(stream); });
    return () => { current = false; element.pause(); element.srcObject = null; };
  }, [stream, camera, video]);
  return <video ref={video} className={`${styles['camera-video']} ${!visible ? styles['camera-hidden'] : ''}`} data-mirrored={mirrored} autoPlay playsInline muted aria-label={t(remote ? 'AI生成画面，效果需人工确认' : '本地相机原画，未进行AI处理')} aria-hidden={!visible} onPlaying={() => camera.markPlaying(stream)} onError={() => camera.playbackFailed(stream)} />;
}
