'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import styles from './studio.module.css';

export type DialogKind = 'guide' | 'privacy' | 'invite' | null;

export function InfoDialog({ kind, onClose }: { kind: DialogKind; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteDemo, setInviteDemo] = useState(false);
  useEffect(() => {
    if (kind && !dialog.current?.open) dialog.current?.showModal();
    if (!kind && dialog.current?.open) dialog.current.close();
  }, [kind]);
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target !== event.currentTarget) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); }}>
    <div className={styles['dialog-heading']}><span className={styles.eyebrow}>{kind === 'guide' ? '映想 · 体验指南' : kind === 'privacy' ? '你的画面，由你决定' : '映想 · 受邀体验'}</span><button className={styles['icon-button']} type="button" onClick={onClose} aria-label="关闭说明"><Icon name="close" /></button></div>
    {kind === 'guide' && <><h2 id="dialog-title">从一个灵感，<br />看见另一种可能。</h2><ol className={styles['guide-steps']}><li><strong>先从实时换装开始</strong><p>选择一张清晰的上衣参考图，或使用示意素材体验流程。</p></li><li><strong>让画面准备就绪</strong><p>当前为本地模拟模式，不访问相机或真实模型；人台插画不代表生成结果。</p></li><li><strong>边看边换，随时结束</strong><p>体验中可以更换参考图、切换预览标签，按下结束即可退出。</p></li></ol><p className={styles['dialog-footnote']}>提示词创作、室内背景、宠物与摆件等方向仍在规划中。</p></>}
    {kind === 'privacy' && <><h2 id="dialog-title">开启映想前，<br />先了解画面如何处理。</h2><div className={styles['privacy-copy']}><p>正式接入后，参考图与相机视频将按明确告知的用途发送给云端模型，首个场景为实时换装。</p><p>当前工程只提供本地模拟，不申请相机或麦克风权限，不发送参考图，不录制或保存画面。</p><p>真实模型的数据处理与留存条件需在接入前核实，换装效果不提供真实尺码或合身保证。</p><p className={styles['prototype-callout']}>你选择的图片只在浏览器内处理；刷新或离开后不恢复。模拟标签切换不会产生真实视频。</p></div></>}
    {kind === 'invite' && <><h2 id="dialog-title">为你的想象，<br />留一个位置。</h2><p className={styles['invite-copy']}>正式邀请系统尚未启用。输入示意码可以走查界面，不会创建账号或取得真实访问资格。</p><form onSubmit={(event) => { event.preventDefault(); if (code.trim().toUpperCase() !== 'YINGXIANG') { setInviteError('示意码不正确，请输入 YINGXIANG。'); setInviteDemo(false); } else { setInviteError(null); setInviteDemo(true); } }}><label className={styles['field-label']} htmlFor="invite-code">原型示意码</label><input id="invite-code" className={styles['text-field']} placeholder="YINGXIANG" value={code} onChange={(event) => { setCode(event.target.value); setInviteDemo(false); }} maxLength={32} autoComplete="off" required />{inviteError && <p className={styles['inline-error']} role="alert">{inviteError}</p>}{inviteDemo && <p className={styles['prototype-callout']} role="status">示意流程已通过，尚未开通真实服务。</p>}<button className={`${styles['primary-button']} ${styles['dialog-primary']}`} type="submit">预览受邀流程 <Icon name="arrow" /></button></form></>}
    <button className={`${styles['primary-button']} ${styles['dialog-primary']}`} type="button" onClick={onClose}>{kind === 'privacy' ? '了解，继续探索' : '回到创作空间'}<Icon name="arrow" /></button>
  </dialog>;
}
