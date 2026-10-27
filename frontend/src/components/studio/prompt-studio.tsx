'use client';

import { useI18n } from '@/components/preferences';
import { MirrorButton } from './mirror-button';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useNotice } from '@/hooks/use-notice';
import { notify } from '@/lib/notices';
import { PROMPT_EXAMPLES, PROMPT_POLICY } from '@/lib/prompt/policy';
import { composePrompt, MAX_INSTRUCTIONS, type EditInstruction } from '@/lib/prompt/composition';
import { promptActive } from '@/lib/prompt/session';
import { CONNECTION_STAGE_LABELS } from '@/lib/prompt/connection-diagnostics';
import { usePromptSession } from '@/hooks/use-prompt-session';
import { useAccount } from '@/hooks/use-account';
import { useGeneratedRecording } from '@/hooks/use-generated-recording';
import { SiteHeader } from '../site/site-header';
import { StudioModes } from './studio-modes';
import { WorkspaceInfo } from './workspace-info';
import { AccountDialog } from './account-dialog';
import { CameraPreview } from './camera-preview';
import { MediaTools } from './media-tools';
import { PreviewSurface } from './preview-surface';
import { Icon } from './icon';
import base from './studio.module.css';
import s from './prompt-studio.module.css';

export function PromptStudio() {
  const { t } = useI18n();
  const { account, error: accountError, refresh } = useAccount();
  const userId = account?.user?.id ?? null;
  const { camera, preview, remote, controller, snapshot, stream, previewState, remoteStream, status, unavailable } = usePromptSession(userId);
  const [login, setLogin] = useState(false), [view, setView] = useState<'original' | 'generated'>('original');
  const [mirrored, setMirrored] = useState(true);
  const [draft, setDraft] = useState(''), [instructions, setInstructions] = useState<EditInstruction[]>([]);
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(3);
  const sequence = useRef(0), input = useRef<HTMLTextAreaElement>(null), previousUser = useRef<string | null>(null);
  const currentInstructions = useRef<EditInstruction[]>([]);
  const stageRef = useRef<HTMLDivElement>(null), localVideoRef = useRef<HTMLVideoElement>(null), remoteVideoRef = useRef<HTMLVideoElement>(null);
  const requesting = previewState.phase === 'requesting', generated = view === 'generated';
  const active = promptActive(snapshot.phase), cameraReady = previewState.phase === 'ready';
  const { save: savedWork } = useGeneratedRecording({ enabled: true, live: snapshot.phase === 'live' || snapshot.phase === 'updating', stream: remoteStream, session: snapshot.deadlineAt, seconds: 15, owner: userId, kind: 'edit', promptHistory: snapshot.history });
  const showRemote = generated && Boolean(remoteStream);
  const captureAvailable = generated ? showRemote && ['live', 'updating'].includes(snapshot.phase) : cameraReady && Boolean(stream);
  const phaseLabel = snapshot.phase === 'connecting' ? '正在连接实时编辑…' : snapshot.phase === 'updating' ? '正在同步提示词组合…' : snapshot.phase === 'live' ? '实时编辑中' : snapshot.phase === 'error' ? '连接已停止，请查看原因' : snapshot.phase === 'ended' ? '本次编辑已结束' : '准备开始实时编辑';
  const pages = Math.max(1, Math.ceil(instructions.length / pageSize)), currentPage = Math.min(page, pages - 1);
  useNotice(previewState.message); useNotice(accountError); useNotice(snapshot.message);
  useNotice(savedWork.phase === 'error' ? savedWork.message : null);
  useEffect(() => {
    const compact = matchMedia('(max-width: 620px), (max-height: 700px)');
    const medium = matchMedia('(max-height: 850px)');
    const update = () => { setPageSize(compact.matches ? 1 : medium.matches ? 2 : 3); setPage(0); };
    update(); compact.addEventListener('change', update); medium.addEventListener('change', update);
    return () => { compact.removeEventListener('change', update); medium.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    const next = account?.user?.id ?? null;
    if (previousUser.current !== next) {
      controller.setConsent(false);
      if (previousUser.current) {
        preview.stop(); currentInstructions.current = []; controller.setDraft('');
        setInstructions([]); setDraft(''); setPage(0); setView('original');
        notify('已清空上一账号的本次提示词。');
      }
    }
    previousUser.current = next;
  }, [account?.user?.id, controller, preview]);
  const changeInstructions = (next: EditInstruction[]) => {
    const prompt = composePrompt(next);
    currentInstructions.current = next; setInstructions(next);
    controller.syncComposition(prompt, next.map(item => item.text));
  };
  const send = () => {
    const text = draft.trim(); if (!text) return;
    if (currentInstructions.current.length >= MAX_INSTRUCTIONS) { notify('本次最多保留12条提示词，请先删除不需要的内容。'); return; }
    try {
      const next = [...currentInstructions.current, { id: sequence.current + 1, text }];
      changeInstructions(next); sequence.current++;
      setPage(Math.floor((next.length - 1) / pageSize)); setDraft(''); setView('generated');
      notify(active ? '正在发送完整提示词组合…' : '已加入组合，确认云端处理后可开始编辑。'); input.current?.focus();
    } catch (error) { notify((error as Error).message); }
  };
  const remove = (id: number) => {
    const next = currentInstructions.current.filter((item) => item.id !== id);
    changeInstructions(next);
    if (!next.length) { setView('original'); notify('已移除全部提示词，已恢复相机原画。'); }
    else notify(active ? '已移除，正在同步剩余提示词…' : '已从本次组合移除。');
  };
  const start = () => {
    if (!userId) { setLogin(true); return; }
    if (accountError) { notify(accountError); return; }
    if (unavailable) { notify(unavailable); return; }
    if (!cameraReady || !camera.isReady()) { notify('请先打开相机并等待预览就绪。'); return; }
    if (!instructions.length || !snapshot.consent) return;
    controller.setDraft(composePrompt(currentInstructions.current), currentInstructions.current.map(item => item.text)); setView('generated');
    void controller.start();
  };
  const toggleCamera = () => { if (stream || requesting) { controller.stop('相机已关闭，实时编辑随之结束。'); preview.stop(); } else void preview.start(); };
  const logout = async () => { controller.setConsent(false); preview.stop(); const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); };
  return <div className={base.studio} data-mode="prompt">
    <SiteHeader active="studio" account={account} onLogin={() => setLogin(true)} onLogout={logout} />
    <main className={`${base['page-shell']} ${base['creation-shell']}`}>
      <div className={base['workbench-title']}><h1>{t("创作空间")}</h1><span>{t("提示词实时编辑")}</span><Link href="/account" prefetch={false}>{t("我的权益 ↗")}</Link></div>
      <StudioModes active="prompt" />
      <div className={base.workspace}>
        <section className={s.editor} aria-labelledby="prompt-title">
          <div className={s.heading}><h2 id="prompt-title">{t("我的提示词")}<span className={s.count}>{instructions.length}</span></h2><span>{t("本次组合")}</span></div>
          <p className={s.intro}>{t("按顺序添加提示词，组合会实时同步到当前画面。")}</p>
          <div className={s.history}>
            {instructions.length ? <ol className={s.cards} aria-label={t("已发送的提示词")}>{instructions.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((item) => <li className={s.card} key={item.id}>
              <p tabIndex={0} aria-label={t(`提示词内容 ${item.id}`)}>{item.text}</p><button className={s.remove} type="button" aria-label={t(`删除提示词 ${item.id}`)} onClick={() => remove(item.id)}><Icon name="close" /></button>
            </li>)}</ol> : <div className={s.historyEmpty}><span className={`${s.seed} star-hover-spin`} aria-hidden="true">✳</span><h3>{t("暂无提示词")}</h3><p>{t("在画面下方输入并发送。")}<br />{t("每条提示词可单独移除。")}</p></div>}
          </div>
          <div className={s.pagination}><span>{t(instructions.length ? `${instructions.length} 条提示词` : '尚未添加提示词')}</span><div><button type="button" aria-label={t("上一页提示词")} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5" /></svg></button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label={t("下一页提示词")} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5" /></svg></button></div></div>
          <div className={s.layerNote}><span aria-hidden="true">＋</span><p>{t("当前提示词共同组成画面。")}<br /><span>{t("移除一条后，剩余提示词继续生效。")}</span></p></div>
          <WorkspaceInfo label={t("使用说明")}><p>{t("先打开相机并添加提示词，再确认云端处理并开始编辑。连接中新增或删除提示词会同步当前完整组合，不重新连接、不延长时间；移除全部提示词会结束生成并恢复相机原画。")}</p><p>{t("收到服务方视频并开始播放后才启动15秒倒计时；连接等待不扣体验时间，另设30秒超时。切到相机原画不会暂停云端处理；指令接受与实际效果以生成画面核对。")}</p><p>{t("开始后，相机视频和提示词经模型连接发送给Decart；不采集音频。生成视频及本轮已同步的提示词组合保存到我的作品，未发送草稿不保存。每条最多500字、本次最多12条；关闭相机、换账号、切后台或离开会停止连接，不自动重连。")}</p></WorkspaceInfo>
          <WorkspaceInfo label={t('连接诊断')}><p>{t('仅保留本页最近一次连接的阶段与耗时，不含画面、提示词或令牌。刷新后清空；出现错误时请先记录这里的信息。')}</p>{snapshot.connectionSteps.length ? <ol>{snapshot.connectionSteps.map((step, index) => <li key={index}>{(step.elapsedMs / 1000).toFixed(1)}s · {t(CONNECTION_STAGE_LABELS[step.stage])}</li>)}</ol> : <p>{t('本页还没有连接诊断记录。')}</p>}{snapshot.message && <p>{t(snapshot.message)}</p>}</WorkspaceInfo>
        </section>
        <PreviewSurface><section data-workspace-preview className={`${base.panel} ${s.preview}`} aria-label={t("实时编辑画面")}>
          <div data-preview-heading className={s.previewHeading}><h2>{t(generated ? '映想画面' : '相机原画')}</h2><span><i data-on={Boolean(stream)} />{t(requesting ? '等待相机授权' : stream ? '相机已开启' : '相机未开启')}</span></div>
          <div data-preview-toolbar className={base['frame-toolbar']}><span>{t(phaseLabel)}</span><span role="status">{active ? snapshot.deadlineAt === null ? t('连接中 · 出画后计时') : `${snapshot.remaining}s` : t('出画后计时 · 最多15秒')}</span></div>
          <div data-preview-viewport className={base['preview-viewport']}><div ref={stageRef} data-preview-stage className={s.stage}>
            {stream && <CameraPreview videoRef={localVideoRef} stream={stream} camera={camera} visible={!generated} mirrored={mirrored} />}
            {remoteStream && <CameraPreview videoRef={remoteVideoRef} stream={remoteStream} camera={remote} visible={generated} remote mirrored={mirrored} />}
            {(!stream || (generated && !showRemote)) && <div className={`${s.empty} ${generated ? s.setup : ''}`} key={view}>
              <div className={s.imagine} aria-hidden="true"><span className="star-hover-spin">✳</span></div>
              <h3>{t(active ? '正在连接实时编辑…' : generated ? '确认后开始实时编辑' : '打开相机开始实时编辑')}</h3>
              {!stream ? <><p>{t(requesting ? '等待相机授权…' : '打开相机后可添加提示词。')}</p><button type="button" data-stage-start className={base['stage-start']} disabled={requesting} onClick={toggleCamera}><Icon name="camera" />{t(requesting ? '取消打开' : '打开相机')}</button></>
                : generated && !active ? <>
                  {!instructions.length && <p>{t('先在下方发送一条提示词。')}</p>}
                  <label className={s.consent}><input type="checkbox" checked={snapshot.consent} onChange={(event) => controller.setConsent(event.target.checked)} /><span>{t('已获素材授权，同意云端处理并保存生成视频与提示词')}</span></label>
                  <button type="button" className={s.start} disabled={Boolean(userId) && (!snapshot.consent || !cameraReady || !instructions.length || Boolean(unavailable) || Boolean(accountError))} onClick={start}>{t(userId ? '开始实时编辑' : '登录后开始编辑')}</button>
                  <span className={s.serviceStatus} role="status">{t(userId ? unavailable ?? status?.message ?? '' : '登录后检查实时编辑测试权限。')}</span>
                  {snapshot.phase === 'error' && snapshot.message && <details className={s.failure}><summary>{t('连接未完成，查看详情')}</summary><p>{t(snapshot.message)}</p></details>}
                </> : <p>{t('连接中可以继续调整提示词，最新组合会在连接就绪后发送。')}</p>}
            </div>}
            <MediaTools targetRef={stageRef} getVideo={() => showRemote ? remoteVideoRef.current : localVideoRef.current} mirrored={mirrored} fileStem={showRemote ? '映想-AI实时编辑' : '映想-相机原画'} disabled={!captureAvailable} />
            <div className={s.badges}><span>{t(showRemote ? '映想画面 ✳ · AI生成' : generated ? '映想画面 ✳' : '相机原画')}</span>{instructions.length > 0 && <span>{instructions.length} {t(" 条提示词")}</span>}</div>
          </div></div>
          <div data-preview-controls className={s.controls}><div className={s.views} role="group" aria-label={t("实时编辑视图")}><button type="button" aria-pressed={!generated} onClick={() => setView('original')}>{t("相机原画")}</button><button type="button" aria-pressed={generated} onClick={() => setView('generated')}>{t("映想画面 ")}<span aria-hidden="true">✳</span></button></div><div className={s.cameraActions}>{active && <button type="button" className={s.stop} onClick={() => controller.stop()}>{t(snapshot.phase === 'connecting' ? '取消连接' : '结束编辑')}</button>}<MirrorButton mirrored={mirrored} onToggle={() => setMirrored((value) => !value)} /><button type="button" className={s.cameraButton} aria-pressed={Boolean(stream) || requesting} onClick={toggleCamera}><Icon name="camera" />{t(requesting ? '取消打开' : stream ? '关闭相机' : '打开相机')}</button></div></div>
          <div data-preview-details className={s.editDetails}><form className={s.composer} onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label htmlFor="edit-prompt">{t("添加提示词")}<span>{t("新提示词会追加到当前组合")}</span></label>
            <div className={s.inputRow}><textarea ref={input} id="edit-prompt" maxLength={PROMPT_POLICY.maxPromptLength} rows={2} placeholder={t("例如：将上衣改为米白色针织开衫，保留人物面部和动作。")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button className={s.send} type="submit" disabled={!draft.trim()}><span>{t("发送")}</span><Icon name="arrow" /></button></div>
            <div className={s.composerFooter}><div className={s.examples} role="group" aria-label={t("提示词示例")}>{PROMPT_EXAMPLES.map((example) => <button type="button" key={example.label} onClick={() => { setDraft(t(example.text)); input.current?.focus(); }}>{t(example.label)}<span aria-hidden="true">＋</span></button>)}</div><span className={s.counter}>{draft.length}/500</span></div>
          </form>
          </div>
        </section></PreviewSurface>
      </div>
      <footer className={base['creation-footer']}><Link href="/privacy#edit" target="_blank" rel="noopener noreferrer">{t("隐私与使用说明 ↗")}</Link><span>{t('实时编辑 · 测试开放')}</span><Link href="/works" prefetch={false}>{t(savedWork.phase === 'saved' ? '已保存到我的作品 ↗' : savedWork.phase === 'saving' ? '后台保存中 · 我的作品 ↗' : '生成视频自动保存 · 我的作品 ↗')}</Link></footer>
    </main>
    {login && <AccountDialog purpose="prompt" account={account} onClose={() => setLogin(false)} onChanged={async () => { await refresh(); setLogin(false); }} onLogout={logout} />}
  </div>;
}
