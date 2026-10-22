'use client';

import { useEffect, useRef } from 'react';
import type { LocalCamera } from '@/lib/media/local-camera';
import styles from './studio.module.css';

export function CameraPreview({ stream, camera, visible, remote = false }: { stream: MediaStream; camera: Pick<LocalCamera, 'markPlaying' | 'playbackFailed'>; visible: boolean; remote?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = true;
    element.srcObject = stream;
    void element.play().catch(() => { if (current) camera.playbackFailed(stream); });
    return () => { current = false; element.pause(); element.srcObject = null; };
  }, [stream, camera]);
  return <video ref={video} className={`${styles['camera-video']} ${remote ? styles['remote-video'] : ''} ${!visible ? styles['camera-hidden'] : ''}`} autoPlay playsInline muted aria-label={remote ? 'AI生成画面，效果需人工确认' : '本地相机原画，未进行AI处理'} aria-hidden={!visible} onPlaying={() => camera.markPlaying(stream)} onError={() => camera.playbackFailed(stream)} />;
}
