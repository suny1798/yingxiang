'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../site/site-header';
import { StudioModes } from './studio-modes';
import { AccountDialog } from './account-dialog';
import { CameraPreview } from './camera-preview';
import { Icon } from './icon';
import { useAccount } from '@/hooks/use-account';
import { usePromptSession } from '@/hooks/use-prompt-session';
import { PROMPT_EXAMPLES, PROMPT_POLICY } from '@/lib/prompt/policy';
import { promptActive } from '@/lib/prompt/session';
import base from './studio.module.css';
import s from './prompt-studio.module.css';

export function PromptStudio() {
  const { controller, snapshot, camera, preview, stream, previewState, remote, remoteStream, status, refresh: refreshService, unavailable } = usePromptSession();
  const { account, error: accountError, refresh } = useAccount();
  const [login, setLogin] = useState(false), [checking, setChecking] = useState(false), [view, setView] = useState<'original' | 'generated'>('original');
  const [error, setError] = useState<string | null>(null);
  const previousUser = useRef<string | null>(null), operation = useRef(0), alive = useRef(true), checkingRef = useRef(false);
  const active = promptActive(snapshot.phase), cameraReady = previewState.phase === 'ready';
  const requesting = previewState.phase === 'requesting', generated = view === 'generated';
  const showRemote = generated && ['live', 'updating'].includes(snapshot.phase) && !!remoteStream;
  const validPrompt = snapshot.draft.trim().length > 0;
  useEffect(() => {
    const next = account?.user?.id ?? null;
    if (previousUser.current !== next) {
      ++operation.current; controller.stop('登录状态已变化。');
      if (previousUser.current) preview.stop();
      controller.setConsent(false);
    }
    previousUser.current = next;
  }, [account?.user?.id, controller, preview]);
  useEffect(() => { if (['ended', 'error'].includes(snapshot.phase)) setView('original'); }, [snapshot.phase]);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => { if (document.hidden) ++operation.current; };
    document.addEventListener('visibilitychange', invalidate);
    return () => { alive.current = false; ++operation.current; document.removeEventListener('visibilitychange', invalidate); };
  }, []);
  const closeCamera = () => { ++operation.current; controller.stop('相机已关闭。'); preview.stop(); setView('original'); };
  const start = async () => {
    if (checkingRef.current || active || !validPrompt || !snapshot.consent || !cameraReady) return;
    checkingRef.current = true; setChecking(true); setError(null); const currentOperation = operation.current;
    try {
      const current = await refresh();
      if (!alive.current || currentOperation !== operation.current || !current || document.hidden) return;
      if (!current.user) { setLogin(true); return; }
      const service = await refreshService();
      if (!alive.current || currentOperation !== operation.current || document.hidden || !camera.isReady()) return;
      if (!service?.available) { setError(service?.message ?? '编辑服务暂不可用。'); return; }
      setView('generated'); void controller.start();
    } finally { checkingRef.current = false; if (alive.current) setChecking(false); }
  };
  const phaseLabel = snapshot.phase === 'connecting' ? '连接中' : snapshot.phase === 'updating' ? '指令发送中' : snapshot.phase === 'live' ? '实时编辑中' : requesting ? '等待相机' : cameraReady ? '相机已开启' : '相机未开启';
  const time = `00:${String(snapshot.remaining).padStart(2, '0')}`;
  return <div className={base.studio}>
    <SiteHeader active="studio" account={account} onLogin={() => setLogin(true)} />
    <main className={`${base['page-shell']} ${base['creation-shell']}`}>
      <div className={base['workbench-title']}><h1>创作空间</h1><span>提示词实时编辑</span><Link href="/account" prefetch={false}>我的权益 ↗</Link></div>
      <StudioModes active="prompt" />
      <div className={s.layout}>
        <section className={s.editor} aria-labelledby="prompt-title">
          <div className={s.heading}><h2 id="prompt-title">想改变什么？</h2><span>纯文字创作</span></div>
          <label className={base['visually-hidden']} htmlFor="edit-prompt">画面修改提示词</label>
          <textarea id="edit-prompt" maxLength={PROMPT_POLICY.maxPromptLength} rows={8} placeholder="描述你希望画面发生的变化，例如：把背景变成阳光下的花园，保留人物的外貌和动作。" value={snapshot.draft} onChange={(event) => controller.setDraft(event.target.value)} />
          <div className={s.counter}><span>{snapshot.draft.length} / 500</span><button type="button" disabled={!snapshot.draft} onClick={() => controller.setDraft('')}>清空</button></div>
          <div className={s.examples} role="group" aria-label="提示词示例">{PROMPT_EXAMPLES.map((example) => <button type="button" key={example.label} onClick={() => controller.setDraft(example.text)}>{example.label}<span aria-hidden="true">↗</span></button>)}</div>
          <p className={s.note}>示例只填入草稿。描述清楚要改哪里、保留什么，再观察实际效果。</p>
          {active ? <button type="button" className={s.apply} disabled={!validPrompt || (snapshot.draft.trim() === snapshot.applied && !snapshot.applying)} onClick={() => controller.apply()}>应用到画面<span aria-hidden="true">↗</span></button> : <button type="button" className={s.apply} onClick={() => setView('generated')}>准备好，前往映想画面<span aria-hidden="true">↗</span></button>}
          <div className={s.applied} aria-live="polite"><span>{snapshot.applying ? '正在发送指令' : snapshot.applied ? '最近发送的指令' : '本次指令'}</span><p>{snapshot.applying ?? snapshot.applied ?? '还未发送。输入草稿不会上传或开启生成。'}</p>{snapshot.applied && <small>指令已发送，效果以实际画面为准。</small>}</div>
          <details className={s.privacy}><summary>画面与隐私说明</summary><p>打开相机仅本机预览，不上传。主动开始后，相机视频与提示词将发送至Decart Lucy2.5。请取得出镜者同意，避免在提示词中输入个人敏感信息。</p><p>不采音频、不默认录制、不保存提示词或媒体。服务端仅保存登录归属、连接申请状态与保守额度预留。更改提示词需点击应用，不延长本次15秒窗口；切到原画仍会继续云端生成，可点击结束编辑停止。</p><p>编辑额度独立于实时换装免费体验，当前尚未开放购买。关闭相机、退出或切换账号、页面进入后台或离开模式会停止全部媒体；结束编辑保留本地预览，不自动重连。示例和中文指令效果尚待真实验证。</p></details>
        </section>
        <section className={`${base.panel} ${s.preview}`} aria-label="实时编辑画面">
          <div className={s.previewHeading}><h2>画面</h2><span role="status">{phaseLabel}</span></div>
          <div className={s.stage}>
            {stream ? <CameraPreview stream={stream} camera={camera} visible={!showRemote} /> : <div className={s.empty}><span className={s.imagine} aria-hidden="true">想</span>{!generated && <><h3>一句话，改写眼前。</h3><p>先打开相机，看看此刻的画面。</p><button type="button" className={s.cameraStart} disabled={requesting} onClick={() => void preview.start()}><Icon name="camera" />{requesting ? '等待授权…' : '打开相机'}</button></>}</div>}
            {remoteStream && <CameraPreview stream={remoteStream} camera={remote} visible={showRemote} remote />}
            <div className={s.badges}><span>{showRemote ? 'AI 生成 · 效果待确认' : stream ? '相机原画' : '本地相机'}</span>{active && <span aria-label="实时编辑剩余时间">{time}</span>}</div>
            {generated && !showRemote && <div className={s.floating} aria-label="开启实时编辑"><span className={s.orbit} aria-hidden="true">✳</span>{active ? <><h3>正在连接映想…</h3><p>准备让指令进入画面。</p><button type="button" className={s.textButton} onClick={() => controller.stop('连接已取消。')}>取消连接</button></> : !cameraReady ? <><h3>先打开相机</h3><p>原画仅在本机预览。</p><button type="button" className={s.cameraStart} disabled={requesting} onClick={() => void preview.start()}><Icon name="camera" />{requesting ? '等待授权…' : '打开相机'}</button></> : <><h3>让这句话，成为画面。</h3><label className={s.consent}><input type="checkbox" checked={snapshot.consent} onChange={(event) => controller.setConsent(event.target.checked)} /><span>我已获授权，同意视频与提示词由Decart云端处理</span></label><button type="button" className={s.start} disabled={!validPrompt || !snapshot.consent || checking || !!unavailable} onClick={() => void start()}>{checking ? '正在验证…' : account?.user ? '开始实时编辑' : '登录后开始'}<span aria-hidden="true">↗</span></button><small>最多15秒 · 修改指令不续时</small>{!validPrompt && <p>先在左侧写下想改变的画面。</p>}</>}</div>}
          </div>
          <div className={s.controls}><div className={s.views} role="group" aria-label="实时编辑视图"><button type="button" aria-pressed={!generated} onClick={() => setView('original')}>相机原画</button><button type="button" aria-pressed={generated} onClick={() => setView('generated')}>映想画面 ✳</button></div><div className={s.actions}>{active && <button type="button" onClick={() => controller.stop()}>结束编辑</button>}<button type="button" aria-pressed={Boolean(stream) || requesting} onClick={() => { if (stream || requesting) closeCamera(); else void preview.start(); }}><Icon name="camera" />{requesting ? '取消打开' : stream ? '关闭相机' : '打开相机'}</button></div></div>
          <div className={s.service}><span>{active ? !generated ? '原画对比中 · 云端编辑仍在继续' : '连接中可修改提示词，点击应用后生效' : unavailable ?? status?.message}</span>{!active && <button type="button" onClick={() => void refreshService()}>刷新状态 ↻</button>}</div>
          {(snapshot.message || previewState.message || error || accountError) && <p role="alert" className={s.error}>{error ?? accountError ?? previewState.message ?? snapshot.message}</p>}
        </section>
      </div>
      <footer className={base['creation-footer']}><span>本地预览不上传 · 不采集音频</span><span>Lucy 2.5 · 标准档</span></footer>
    </main>
    {login && <AccountDialog purpose="prompt" account={account} onClose={() => setLogin(false)} onChanged={async () => { await refresh(); setLogin(false); }} onLogout={async () => { closeCamera(); const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); }} />}
  </div>;
}
