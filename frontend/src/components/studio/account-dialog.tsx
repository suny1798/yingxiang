'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountView } from '@/lib/account';
import { durationLabel } from '@/lib/studio/policy';
import { Icon } from './icon';
import styles from './studio.module.css';

export function AccountDialog({ account, onClose, onChanged, onLogout }: {
  account: AccountView | null; onClose: () => void; onChanged: () => Promise<unknown>; onLogout: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || (register && !confirmed)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/account/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? '账号操作未完成，请重试。');
      setPassword(''); await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '账号操作未完成。'); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError(null);
    try { await onLogout(); onClose(); }
    catch { setError('退出未完成，请稍后再试。'); }
    finally { setBusy(false); }
  };
  const remaining = account?.trialRemaining ?? 0;
  const trialLabel = remaining > 0 ? `${remaining}次免费体验` : account?.trial === 'review' ? '这次体验待核查' : '免费体验已使用';
  return <dialog ref={dialog} className={styles['account-dialog']} aria-labelledby="account-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (!busy && event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className={styles['dialog-heading']}><span className={styles.eyebrow}>映想 · {account?.user ? '我的空间' : '从这里，开始想象'}</span><button type="button" disabled={busy} className={styles['icon-button']} aria-label="关闭账号" onClick={onClose}><Icon name="close" /></button></div>
    {account?.user ? <>
      <div className={styles['account-identity']}><span className={styles['account-avatar']} aria-hidden="true">{account.user.username.charAt(0).toUpperCase()}</span><div><h2 id="account-title">{account.user.username}</h2><p>你的灵感，从这里开始。</p></div></div>
      <section className={styles['trial-ticket']} aria-label="体验权益"><span className={styles['ticket-kicker']}>新用户礼遇</span><strong>{trialLabel}</strong><p>{remaining > 0 ? `${account.trialLimit > 1 ? `共${account.trialLimit}次，已用${account.trialLimit - remaining}次；` : '每个账号一次，'}每次连接窗口最多15秒，准备好参考图再开启。` : account.trial === 'review' ? '已提交连接申请，结果尚未确认。请联系开发者核查，不会自动再次连接。' : '感谢你的尝试。更多体验方案正在准备中。'}</p><span className={styles['ticket-note']}>付费体验暂未开放 · 不自动续费</span></section>
      <div className={styles['account-section-heading']}><h3>使用记录</h3><span>最近20条 · 仅保留状态</span></div>
      {account.history.length ? <ul className={styles['usage-list']}>{account.history.map((entry) => <li key={entry.id}><div><strong>实时换装 · {durationLabel(entry.durationSec)}</strong><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(entry.createdAt))}</time></div><span>{entry.state === 'review' ? '待核查' : entry.outcome === 'ended' ? '已结束' : entry.outcome === 'error' ? '连接异常' : '已申请连接'}</span></li>)}</ul> : <p className={styles['account-empty']}>还没有使用记录。选一件上衣，开始第一次体验。</p>}
      <div className={styles['account-footer']}><p>不保存你的参考图或视频。</p><button type="button" className={styles['text-button']} disabled={busy} onClick={() => void logout()}>{busy ? '正在退出…' : '退出登录'}</button></div>
    </> : <>
      <h2 id="account-title">{register ? '留一个位置，\n给你的想象。' : '欢迎回到\n你的创作空间。'}</h2>
      <p className={styles['account-subtitle']}>{register ? '创建账号，领取一次免费体验。' : '登录后查看体验权益，继续探索画面。'}</p>
      <div className={styles['auth-tabs']} role="group" aria-label="账号操作"><button type="button" disabled={busy} aria-pressed={!register} onClick={() => { setRegister(false); setError(null); setPassword(''); }}>登录</button><button type="button" disabled={busy} aria-pressed={register} onClick={() => { setRegister(true); setError(null); setPassword(''); }}>创建账号</button></div>
      <form onSubmit={(event) => void submit(event)} className={styles['account-form']}>
        <label htmlFor="account-username">账号<span>3—24位字母、数字或下划线</span></label><input id="account-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
        <label htmlFor="account-password">密码<span>8—128位</span></label><input id="account-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
        {register && <label className={styles['account-confirm']}><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /><span>我了解每个账号仅有一次免费体验；开启前还需单独确认云端画面处理说明。</span></label>}
        <button type="submit" disabled={busy || (register && !confirmed)} className={`${styles['primary-button']} ${styles['dialog-primary']}`}>{busy ? '正在处理…' : register ? '创建账号，领取体验' : '登录'}<Icon name="arrow" /></button>
      </form><p className={styles['account-footnote']}>当前使用账号密码登录，手机号登录与在线购买尚未开放。请妥善保存密码，暂不支持找回。</p>
    </>}
    {error && <p className={styles['account-error']} role="alert">{error}</p>}
  </dialog>;
}
