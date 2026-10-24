'use client';

import { MirrorButton } from './mirror-button';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useNotice } from '@/hooks/use-notice';
import { notify } from '@/lib/notices';
import { LocalCamera } from '@/lib/media/local-camera';
import { CameraPreviewSession } from '@/lib/media/camera-preview-session';
import { PROMPT_EXAMPLES, PROMPT_POLICY } from '@/lib/prompt/policy';
import { useAccount } from '@/hooks/use-account';
import { SiteHeader } from '../site/site-header';
import { StudioModes } from './studio-modes';
import { WorkspaceInfo } from './workspace-info';
import { AccountDialog } from './account-dialog';
import { CameraPreview } from './camera-preview';
import { PreviewSurface } from './preview-surface';
import { Icon } from './icon';
import base from './studio.module.css';
import s from './prompt-studio.module.css';

interface EditInstruction { id: number; text: string }

/** 本轮仅实现本地交互，不调用旧版单指令会话或模拟云端生效。 */
export function PromptStudio() {
  const { account, error: accountError, refresh } = useAccount();
  const [camera] = useState(() => new LocalCamera());
  const [preview] = useState(() => new CameraPreviewSession(camera));
  const stream = useSyncExternalStore(camera.subscribe, camera.getSnapshot, camera.getServerSnapshot);
  const previewState = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const [login, setLogin] = useState(false), [view, setView] = useState<'original' | 'generated'>('original');
  const [mirrored, setMirrored] = useState(true);
  const [draft, setDraft] = useState(''), [instructions, setInstructions] = useState<EditInstruction[]>([]);
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(3);
  const sequence = useRef(0), input = useRef<HTMLTextAreaElement>(null), previousUser = useRef<string | null>(null);
  const requesting = previewState.phase === 'requesting', generated = view === 'generated';
  const pages = Math.max(1, Math.ceil(instructions.length / pageSize)), currentPage = Math.min(page, pages - 1);
  useNotice(previewState.message); useNotice(accountError);
  useEffect(() => {
    const compact = matchMedia('(max-width: 620px), (max-height: 700px)');
    const medium = matchMedia('(max-height: 850px)');
    const update = () => { setPageSize(compact.matches ? 1 : medium.matches ? 2 : 3); setPage(0); };
    update(); compact.addEventListener('change', update); medium.addEventListener('change', update);
    return () => { compact.removeEventListener('change', update); medium.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    const stop = () => preview.stop(), hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop); stop(); };
  }, [preview]);
  useEffect(() => {
    const next = account?.user?.id ?? null;
    if (previousUser.current && previousUser.current !== next) {
      preview.stop(); setInstructions([]); setDraft(''); setPage(0); setView('original');
      notify('已清空上一账号的本次提示词。');
    }
    previousUser.current = next;
  }, [account?.user?.id, preview]);
  const send = () => {
    const text = draft.trim(); if (!text) return;
    if (instructions.length >= 12) { notify('本次最多保留12条提示词，请先删除不需要的内容。'); return; }
    setInstructions([...instructions, { id: ++sequence.current, text }]);
    setPage(Math.floor(instructions.length / pageSize)); setDraft('');
    notify('已加入组合 · 画面同步待接入'); input.current?.focus();
  };
  const remove = (id: number) => {
    setInstructions((items) => items.filter((item) => item.id !== id));
    notify('已从组合移除 · 画面还原待接入');
  };
  const logout = async () => { preview.stop(); const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); };
  return <div className={base.studio} data-mode="prompt">
    <SiteHeader active="studio" account={account} onLogin={() => setLogin(true)} onLogout={logout} />
    <main className={`${base['page-shell']} ${base['creation-shell']}`}>
      <div className={base['workbench-title']}><h1>创作空间</h1><span>提示词实时编辑</span><Link href="/account" prefetch={false}>我的权益 ↗</Link></div>
      <StudioModes active="prompt" />
      <div className={base.workspace}>
        <section className={s.editor} aria-labelledby="prompt-title">
          <div className={s.heading}><h2 id="prompt-title">我的提示词<span className={s.count}>{instructions.length}</span></h2><span>本次组合</span></div>
          <p className={s.intro}>一点点添加，让画面长成你的想象。</p>
          <div className={s.history}>
            {instructions.length ? <ol className={s.cards} aria-label="已发送的提示词">{instructions.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((item) => <li className={s.card} key={item.id}>
              <div className={s.cardHeading}><span><i aria-hidden="true">✳</i> 提示词 {String(item.id).padStart(2, '0')}</span><button type="button" aria-label={`删除提示词 ${item.id}`} onClick={() => remove(item.id)}><Icon name="close" /></button></div>
              <p>{item.text}</p><div className={s.cardFooter}><span>已加入组合 · 待同步</span><WorkspaceInfo label="查看全文"><p>{item.text}</p></WorkspaceInfo></div>
            </li>)}</ol> : <div className={s.historyEmpty}><span className={`${s.seed} star-hover-spin`} aria-hidden="true">✳</span><h3>变化，从一句话开始</h3><p>在画面下方写下想法并发送。<br />每条想法会留在这里，随时可移除。</p></div>}
          </div>
          <div className={s.pagination}><span>{instructions.length ? `${instructions.length} 条想法叠加中` : '还没有发送提示词'}</span><div><button type="button" aria-label="上一页提示词" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label="下一页提示词" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>›</button></div></div>
          <div className={s.layerNote}><span aria-hidden="true">＋</span><p>保留的提示词共同组成画面。<br /><span>移除一条，保留其他想法。</span></p></div>
          <WorkspaceInfo label="使用说明"><p>本轮先预览新版界面。发送、叠加和删除仅更新本页的提示词组合，尚未同步模型；移除后还原对应画面的逻辑将在下一步接入。新版暂不提供旧版单指令生成入口，原会话代码与服务配置保留。</p><p>相机可独立开启，仅本机预览；映想画面当前为待接入状态。不采集音频、不录制、不上传媒体或提示词。提示词只留在本页内存，刷新或离开页面后清空。</p><p>每条最多500字，本页暂可组合12条，通过分页查看。关闭相机、切换账号、页面进入后台或离开页面会停止相机。</p></WorkspaceInfo>
        </section>
        <PreviewSurface><section data-workspace-preview className={`${base.panel} ${s.preview}`} aria-label="实时编辑画面">
          <div data-preview-heading className={s.previewHeading}><h2>{generated ? '映想画面' : '相机原画'}</h2><span><i data-on={Boolean(stream)} />{requesting ? '等待相机授权' : stream ? '相机已开启' : '相机未开启'}</span></div>
          <div data-preview-toolbar className={base['frame-toolbar']}><span>本次提示词组合</span><span>交互预览 · 画面同步待接入</span></div>
          <div data-preview-viewport className={base['preview-viewport']}><div data-preview-stage className={s.stage}>
            {stream && <CameraPreview stream={stream} camera={camera} visible={!generated} mirrored={mirrored} />}
            {(!stream || generated) && <div className={s.empty} key={view}><div className={s.imagine} aria-hidden="true"><span className="star-hover-spin">✳</span></div><h3>{generated ? '让想法，慢慢进入画面。' : '先看见此刻，再想象下一刻。'}</h3><p>{generated ? '先在下方发送提示词，组合你的画面变化。' : '可以先打开相机，再慢慢写下你的想法。'}</p>{!stream && !requesting && <button type="button" data-stage-start className={base['stage-start']} onClick={() => void preview.start()}><Icon name="camera" />打开相机</button>}{generated && <span className={s.previewLabel}>交互预览 · 画面同步待接入</span>}</div>}
            <div className={s.badges}><span>{generated ? '映想画面 ✳ · 待接入' : '相机原画'}</span>{instructions.length > 0 && <span>{instructions.length} 条提示词</span>}</div>
          </div></div>
          <div data-preview-controls className={s.controls}><div className={s.views} role="group" aria-label="实时编辑视图"><button type="button" aria-pressed={!generated} onClick={() => setView('original')}>相机原画</button><button type="button" aria-pressed={generated} onClick={() => setView('generated')}>映想画面 <span aria-hidden="true">✳</span></button></div><div className={s.cameraActions}><MirrorButton mirrored={mirrored} onToggle={() => setMirrored((value) => !value)} /><button type="button" className={s.cameraButton} aria-pressed={Boolean(stream) || requesting} onClick={() => { if (stream || requesting) preview.stop(); else void preview.start(); }}><Icon name="camera" />{requesting ? '取消打开' : stream ? '关闭相机' : '打开相机'}</button></div></div>
          <div data-preview-details className={s.editDetails}><form className={s.composer} onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label htmlFor="edit-prompt">接下来，想改变什么？<span>新增想法会与已有提示词叠加</span></label>
            <div className={s.inputRow}><textarea ref={input} id="edit-prompt" maxLength={PROMPT_POLICY.maxPromptLength} rows={2} placeholder="例如：把背景变成阳光下的花园，保留人物的外貌和动作…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button className={s.send} type="submit" disabled={!draft.trim()}><span>发送</span><Icon name="arrow" /></button></div>
            <div className={s.composerFooter}><div className={s.examples} role="group" aria-label="提示词示例">{PROMPT_EXAMPLES.map((example) => <button type="button" key={example.label} onClick={() => { setDraft(example.text); input.current?.focus(); }}>{example.label}<span aria-hidden="true">＋</span></button>)}</div><span className={s.counter}>{draft.length}/500</span></div>
          </form>
          </div>
        </section></PreviewSurface>
      </div>
      <footer className={base['creation-footer']}><Link href="/privacy#edit" target="_blank" rel="noopener noreferrer">隐私与使用说明 ↗</Link><span>新版交互预览</span></footer>
    </main>
    {login && <AccountDialog purpose="prompt" account={account} onClose={() => setLogin(false)} onChanged={async () => { await refresh(); setLogin(false); }} onLogout={logout} />}
  </div>;
}
