'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './icon';
import styles from './studio.module.css';

export type DialogKind = 'guide' | 'privacy' | null;

export function InfoDialog({ kind, onClose }: { kind: DialogKind; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (kind && !dialog.current?.open) dialog.current?.showModal();
    if (!kind && dialog.current?.open) dialog.current.close();
  }, [kind]);
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target !== event.currentTarget) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); }}>
    <div className={styles['dialog-heading']}><span className={styles.eyebrow}>{kind === 'guide' ? '映想 · 体验指南' : '你的画面，由你决定'}</span><button className={styles['icon-button']} type="button" onClick={onClose} aria-label="关闭说明"><Icon name="close" /></button></div>
    {kind === 'guide' && <><h2 id="dialog-title">先看看自己，<br />再试一个新想法。</h2><ol className={styles['guide-steps']}><li><strong>随时打开相机</strong><p>无需登录或选图即可本地预览，不上传画面，也不消耗体验次数。</p></li><li><strong>切到「映想画面」</strong><p>在悬浮卡里选择服装图片，确认云端处理；点击开始后才验证登录与权益，并连接真实换装。</p></li><li><strong>换装结束，预览继续</strong><p>可选择15秒、30秒或1分钟连接窗口，均含建连；免费为15秒，长时需对应权益。可随时结束换装，继续查看本机原画；关闭相机、退出、切后台或离开页面会关闭媒体。</p></li></ol></>}
    {kind === 'privacy' && <><h2 id="dialog-title">画面如何处理，<br />由你决定。</h2><div className={styles['privacy-copy']}><p>打开相机只在本机预览，不发送到模型、不消耗次数。只有你在「映想画面」里确认并点击开始，图片与视频才会发送至 Decart 云端进行换装。</p><p>请使用有权上传的参考图，并取得画面中参与者的同意。当前免费体验的模型费用由映想承担；签发结果不确定时保留待核查，不会自动重新连接。</p><p>不采集音频、不默认录制、不保存图片或视频。仅保留有限连接及资源关闭状态。结束换装会断开云端连接，本地相机可继续预览；关闭相机、退出登录、切后台或离开页面则关闭全部媒体。</p><p>生成结果仅供视觉参考，不提供尺码或合身保证。相机原画镜像，生成画面不额外镜像。供应商规则见<a href="https://docs.platform.decart.ai/resources/privacy-policy" target="_blank" rel="noreferrer"> Decart 隐私说明 ↗</a>。</p></div></>}
    <button className={`${styles['primary-button']} ${styles['dialog-primary']}`} type="button" onClick={onClose}>{kind === 'privacy' ? '了解，继续探索' : '回到创作空间'}<Icon name="arrow" /></button>
  </dialog>;
}
