'use client';

import { MirrorButton } from './mirror-button';

import { PreviewSurface } from './preview-surface';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../site/site-header';
import { StudioModes } from './studio-modes';
import { Icon } from './icon';
import { VideoHistory } from './video-history';
import { refreshVideoSelection } from '@/lib/video/history-selection';
import { AccountDialog } from './account-dialog';
import { useAccount } from '@/hooks/use-account';
import { useGarmentInput } from '@/hooks/use-garment-input';
import type { Garment } from '@/lib/try-on/types';
import { useNotice } from '@/hooks/use-notice';
import { useOrientedDownload } from '@/hooks/use-oriented-download';
import { notices, notify } from '@/lib/notices';
import { prepareVideo, type PreparationProgress } from '@/lib/video/prepare';
import { inspectVideo } from '@/lib/video/mp4';
import { VIDEO_POLICY, VIDEO_STATE_LABEL, type VideoJobView, type VideoServiceView } from '@/lib/video/policy';
import base from './studio.module.css';
import s from './video-studio.module.css';
import action from './preview-action.module.css';

async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '操作未完成，请稍后重试。');
  return value as T;
}
const inProgress = (job: VideoJobView) => ['pending', 'processing'].includes(job.state) && !job.expired;

export function VideoStudio() {
  const { account, error: accountError, refresh } = useAccount();
  const [login, setLogin] = useState(false);
  const [garment, setGarment] = useState<Garment | null>(null);
  const onGarment = useCallback((value: Garment | null) => setGarment(value), []);
  const images = useGarmentInput(onGarment);
  const [video, setVideo] = useState<{ file: File; url: string; seconds: number } | null>(null);
  const [validating, setValidating] = useState(false);
  const [preparation, setPreparation] = useState<PreparationProgress | null>(null);
  const preparationAbort = useRef<AbortController | null>(null);
  const [consent, setConsent] = useState(false);
  const [service, setService] = useState<VideoServiceView | null>(null);
  useNotice(service && !service.available ? service.message : null, 'info');
  const [selected, setSelected] = useState<VideoJobView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNotice(error);
  const [resultFailed, setResultFailed] = useState(false);
  const [resultRevision, setResultRevision] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null);
  const videoUrl = useRef<string | null>(null), validation = useRef(0), generation = useRef(0), busy = useRef(false);
  const alive = useRef(true), submitAbort = useRef<AbortController | null>(null);
  const lastUser = useRef<string | null>(null);
  const attempt = useRef<string | null>(null);
  const load = useCallback(async () => {
    const revision = generation.current;
    try {
      const value = await json<VideoServiceView>(await fetch('/api/video/jobs', { cache: 'no-store' }));
      if (alive.current && generation.current === revision) {
        setService(value);
        setSelected((current) => refreshVideoSelection(current, value.jobs));
      }
    } catch (cause) { if (alive.current && generation.current === revision) setError(cause instanceof Error ? cause.message : '任务读取失败。'); }
  }, []);
  useEffect(() => {
    const userId = account?.user?.id ?? null;
    if (lastUser.current !== userId) {
      ++generation.current; submitAbort.current?.abort(); attempt.current = null;
      setSelected(null); setService(null); setShowResult(false); setConsent(false);
    }
    lastUser.current = userId;
    if (account) void load();
  }, [account?.user?.id, Boolean(account), load]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++generation.current; ++validation.current; preparationAbort.current?.abort(); submitAbort.current?.abort(); if (videoUrl.current) URL.revokeObjectURL(videoUrl.current); };
  }, []);
  const progressKey = service?.jobs.filter(inProgress).map((job) => job.id).join(',') ?? '';
  useEffect(() => {
    if (!progressKey) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failed = false;
    const update = async () => {
      if (document.hidden || controller.signal.aborted) { if (!controller.signal.aborted) timer = setTimeout(update, 4000); return; }
      try {
        let finished = false;
        for (const id of progressKey.split(',')) {
          const job = await json<VideoJobView>(await fetch(`/api/video/jobs/${id}`, { cache: 'no-store', signal: controller.signal }));
          if (controller.signal.aborted) return;
          setService((value) => value && ({ ...value, jobs: value.jobs.map((item) => item.id === job.id ? job : item) }));
          setSelected((value) => value?.id === job.id ? { ...value, ...job } : value);
          if (!inProgress(job)) finished = true;
        }
        if (finished) await load();
        failed = false;
      } catch (cause) { if (!controller.signal.aborted) { failed = true; setError(cause instanceof Error ? cause.message : '进度读取失败，可手动刷新。'); } }
      if (!controller.signal.aborted) timer = setTimeout(update, failed ? 15_000 : 4000);
    };
    timer = setTimeout(update, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [progressKey, load]);
  const priorJob = useRef<{ id: string; state: string } | null>(null);
  useEffect(() => { if (selected && priorJob.current?.id === selected.id && priorJob.current.state !== selected.state) { if (selected.state === 'completed') notify('换装视频已生成，可以预览和下载。', 'success'); if (selected.state === 'failed') notify('视频换装未完成，请检查任务状态后再试。', 'error'); } priorJob.current = selected ? { id: selected.id, state: selected.state } : null; }, [selected?.id, selected?.state]);
  useEffect(() => { setShowResult(selected?.state === 'completed'); setResultFailed(false); }, [selected?.id, selected?.state]);
  const chooseVideo = async (file?: File) => {
    if (!file) return;
    preparationAbort.current?.abort();
    const abort = new AbortController(); preparationAbort.current = abort;
    const revision = ++validation.current; setValidating(true); setPreparation(null); setError(null);
    let noticeId: string | null = null;
    try {
      if (file.size > VIDEO_POLICY.maxBytes || !file.name.toLowerCase().endsWith('.mp4')) throw new Error('请选择不超过25MB的MP4视频。');
      let preparedFile = file;
      let info = inspectVideo(new Uint8Array(await file.arrayBuffer()), { allowAudio: true });
      if (!alive.current || revision !== validation.current) return;
      if (info.hasAudio) {
        noticeId = notices.show({ kind: 'progress', message: '检测到音轨，系统会自动移除。无需手动剪辑。', progress: 0, label: '上传视频' });
        const result = await prepareVideo(file, abort.signal, (progress) => {
          if (!alive.current || revision !== validation.current) return;
          setPreparation(progress);
          notices.show({ id: noticeId!, kind: 'progress', message: progress.stage === 'processing' ? '正在自动移除音轨，画质和时长保持不变。' : '系统正在准备无声视频，请稍候。', progress: progress.percent, label: progress.stage === 'upload' ? '上传视频' : progress.stage === 'download' ? '接收处理结果' : '正在处理' });
        });
        info = inspectVideo(new Uint8Array(await result.arrayBuffer()));
        preparedFile = new File([result], file.name, { type: 'video/mp4', lastModified: file.lastModified });
      }
      if (!alive.current || revision !== validation.current) return;
      const url = URL.createObjectURL(preparedFile);
      if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
      videoUrl.current = url; setSelected(null); setVideo({ file: preparedFile, url, seconds: info.seconds }); setConsent(false); setShowResult(false); attempt.current = null;
      notify(noticeId ? '音轨已自动移除，视频已准备好。' : '视频已准备好。', 'success');
    } catch (cause) { if (!abort.signal.aborted && alive.current && revision === validation.current) { const message = cause instanceof Error ? cause.message : '视频无法读取。'; setError(message); notify(message, 'error'); } }
    finally { if (noticeId) notices.dismiss(noticeId); if (alive.current && revision === validation.current) { setValidating(false); setPreparation(null); } }
  };
  const removeVideo = () => {
    preparationAbort.current?.abort(); setPreparation(null);
    ++validation.current; if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
    videoUrl.current = null; setVideo(null); setValidating(false); setConsent(false); attempt.current = null;
  };
  const submit = async () => {
    if (busy.current || validating || images.processing || !video || !garment?.blob || !consent) return;
    busy.current = true; setSubmitting(true); setError(null);
    const revision = generation.current;
    try {
      const current = await refresh();
      if (!alive.current || revision !== generation.current || !current || document.hidden) return;
      if (!current.user) { setLogin(true); return; }
      const ready = await json<VideoServiceView>(await fetch('/api/video/jobs', { cache: 'no-store' }));
      if (!alive.current || revision !== generation.current) return;
      setService(ready);
      if (!ready.available) { setError(ready.message); return; }
      const id = attempt.current ??= crypto.randomUUID();
      const form = new FormData(); form.set('data', video.file, 'person.mp4'); form.set('reference_image', garment.blob, 'garment.png'); form.set('consentVersion', VIDEO_POLICY.consentVersion);
      const controller = new AbortController(); submitAbort.current = controller;
      // 任务先落服务端元数据；丢失响应后通过列表恢复，不自动再次POST。
      let job: VideoJobView;
      try { job = await json<VideoJobView>(await fetch('/api/video/jobs', { method: 'POST', headers: { 'X-Video-Attempt': id }, body: form, signal: controller.signal })); }
      catch { throw new Error('提交结果尚未确认，请刷新任务核查，不要再次生成。'); }
      if (!alive.current || revision !== generation.current) return;
      setSelected(job); setShowResult(job.state === 'completed'); notify('视频已提交处理，可在“历史视频”查看进度。', 'success'); await load();
    } catch (cause) { if (alive.current && revision === generation.current) setError(cause instanceof Error ? cause.message : '操作未完成，请刷新任务核查。'); }
    finally { busy.current = false; if (alive.current) setSubmitting(false); }
  };
  const refreshJobs = async () => {
    setError(null);
    for (const job of service?.jobs.filter(inProgress) ?? []) {
      try { await json(await fetch(`/api/video/jobs/${job.id}`, { cache: 'no-store' })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '任务查询失败。'); }
    }
    await load();
  };
  const selectedImage = images.garments.find((item) => item.id === images.selectedId);
  const needsLogin = account !== null && !account.user;
  const canSubmit = Boolean(video && garment?.blob && consent && !validating && !images.processing && !submitting && (needsLogin || service?.available));
  const resultUrl = selected && !selected.expired && selected.state === 'completed' ? `/api/video/jobs/${selected.id}/content?v=${resultRevision}` : null;
  const orientedDownload = useOrientedDownload(resultUrl, selected?.title?.replace(/[<>:"/\\|?*]/g, '_') || '映想-视频换装', account?.user?.id ?? null);
  const logout = async () => { const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); };
  return <div className={base.studio} data-mode="video">
    <SiteHeader active="studio" account={account} onLogin={() => setLogin(true)} onLogout={logout} />
    <main className={`${base['page-shell']} ${base['creation-shell']}`}>
      <div className={base['workbench-title']}><h1>创作空间</h1><span>视频换装</span><Link href="/account" prefetch={false}>我的权益 ↗</Link></div>
      <StudioModes active="video" />
      <div className={base.workspace}>
        <section className={s.inputs} aria-label="视频换装素材">
          <div className={s.fieldHeading}><h2>人物视频</h2><span>1—15秒</span></div>
          <input className={base['visually-hidden']} ref={videoInput} type="file" accept="video/mp4,.mp4" aria-label="选择人物视频" tabIndex={-1} onChange={(event) => { void chooseVideo(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" className={s.videoUpload} title={video?.file.name} disabled={submitting} onClick={() => videoInput.current?.click()}><span className={video && !validating ? s.uploadReady : undefined} aria-hidden="true">{video && !validating ? <Icon name="check" /> : '▷'}</span><strong>{validating ? '正在检查视频…' : video ? '视频已就绪' : '选择人物视频'}</strong><small>{video ? '点击更换' : 'MP4 · 最长15秒 · 最大25MB'}</small></button>
          {video && <div className={s.fileRow}><span title={video.file.name}>{video.file.name}</span><span className={s.videoDuration}>{video.seconds.toFixed(1)} 秒</span><button type="button" disabled={submitting} onClick={removeVideo}>移除</button></div>}
          <div className={s.fieldHeading}><h2>服装参考图</h2></div>
          <input className={base['visually-hidden']} ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择视频换装服装图" tabIndex={-1} onChange={(event) => { void images.uploadMany(Array.from(event.target.files ?? [])); event.target.value = ''; setConsent(false); }} />
          <button type="button" disabled={submitting || images.processing || images.garments.length >= 6} className={s.imageUpload} onClick={() => imageInput.current?.click()}>{selectedImage ? <img src={selectedImage.previewUrl} alt="本次换装服装参考图" /> : <><span aria-hidden="true">＋</span><strong>选择服装图片</strong><small>JPG / PNG / WebP · ≤10MB</small></>}</button>
          {!!images.garments.length && <div className={s.wardrobe} role="group" aria-label="视频服装选择">{images.garments.map((item, index) => <div key={item.id}><button type="button" disabled={submitting} aria-pressed={item.id === images.selectedId} aria-label={`使用服装${index + 1}`} onClick={() => { images.select(item.id); setConsent(false); }}><img src={item.previewUrl} alt="" /></button><button type="button" disabled={submitting} className={s.removeImage} aria-label={`移除视频服装${index + 1}`} onClick={() => { images.remove(item.id); setConsent(false); }}>×</button></div>)}{images.garments.length < 6 && <button type="button" disabled={submitting || images.processing} aria-label="添加视频服装图" onClick={() => imageInput.current?.click()}>＋</button>}</div>}
          {images.processing && <p role="status" className={s.note}>图片处理中…</p>}
          {images.error && <p role="alert" className={s.error}>{images.error}</p>}
          {validating && <div className={s.preparation} role="status"><strong>{preparation?.stage === 'processing' ? '正在自动移除音轨…' : preparation?.stage === 'download' ? '正在接收处理结果…' : preparation ? '正在上传视频…' : '正在检查视频…'}</strong><progress aria-label="视频处理进度" max={100} value={preparation?.percent} /><button type="button" onClick={() => { preparationAbort.current?.abort(); ++validation.current; setValidating(false); setPreparation(null); notify('已取消视频处理。', 'info'); }}>取消处理</button></div>}

        </section>
        <PreviewSurface><section data-workspace-preview className={s.output} aria-labelledby="video-preview-title">
          <div data-preview-heading className={s.outputHeading}><h2 id="video-preview-title">{showResult && resultUrl ? '换装结果' : '视频预览'}</h2><span>{selected ? selected.expired ? '访问已过期' : VIDEO_STATE_LABEL[selected.state] : video ? '本地预览' : '等待素材'}</span>{selected && <button type="button" className={s.returnCreate} onClick={() => { setSelected(null); setShowResult(false); }}>返回创作</button>}</div>
          <div data-preview-toolbar className={base['frame-toolbar']}><span>MP4 · 最长 {VIDEO_POLICY.maxSeconds} 秒 · 自动移除音轨</span><span>{video ? `本地预览 · ${video.seconds.toFixed(1)} 秒` : '生成后可预览与下载'}</span></div>
          <div data-preview-viewport className={base['preview-viewport']}><div data-preview-stage className={s.stage}>
            {validating ? <div className={s.empty}><h3>正在准备你的视频</h3><p>音轨会自动移除，完成后即可预览。</p></div> : showResult && resultUrl ? resultFailed ? <div className={s.empty}><p>暂时无法播放结果</p><button type="button" onClick={() => { setResultFailed(false); setResultRevision((value) => value + 1); }}>重新加载</button></div> : <video data-mirrored={mirrored} key={resultUrl} src={resultUrl} controls playsInline preload="metadata" onError={() => setResultFailed(true)} aria-label="生成的换装视频" /> : video ? <video data-mirrored={mirrored} key={video.url} src={video.url} controls muted playsInline preload="metadata" aria-label="本地人物视频预览" /> : <div className={s.empty}><span aria-hidden="true" className={s.filmFrame}>▷</span><h3>把新的穿搭，带进这段画面。</h3><p>选一段人物视频，再放入喜欢的服装。</p><button type="button" data-stage-start className={base['stage-start']} onClick={() => videoInput.current?.click()}><Icon name="upload" />选择人物视频</button></div>}
            {selected && inProgress(selected) && <div role="status" className={s.processing}><span className={s.spinner} aria-hidden="true" />{VIDEO_STATE_LABEL[selected.state]}<small>可离开页面，稍后回来查看</small></div>}
          </div></div>
          <div data-preview-controls className={s.previewActions}><div className={s.switch}><button type="button" aria-pressed={!showResult} disabled={!video} onClick={() => setShowResult(false)}>原视频</button><button type="button" aria-pressed={showResult} disabled={!resultUrl} onClick={() => setShowResult(true)}>换装结果</button></div><div className={s.videoActions}><MirrorButton mirrored={mirrored} disabled={orientedDownload.busy} onToggle={() => setMirrored((value) => !value)} />{resultUrl ? <button type="button" data-preview-action className={action.button} onClick={() => orientedDownload.busy ? orientedDownload.cancel() : void orientedDownload.download(mirrored)}><Icon name="download" />{orientedDownload.busy ? '取消导出' : '下载视频'}</button> : <button type="button" data-preview-action className={action.button} disabled title="生成完成后可下载MP4"><Icon name="download" />下载视频</button>}</div></div>
          <div data-preview-details className={s.submitArea}>
            <label className={s.consent}><input type="checkbox" checked={consent} disabled={submitting} onChange={(event) => setConsent(event.target.checked)} /><span>同意云端处理 · <Link href="/privacy#video" target="_blank" rel="noopener noreferrer">隐私说明 ↗</Link></span></label>
            <div className={s.submitRow}><p className={service && !service.available ? undefined : s.submitHint}>{service && !service.available ? service.message : '生成后可回放、下载 · 素材仅用于本次处理'}</p><button type="button" className={s.generate} disabled={!canSubmit} onClick={() => void submit()}>{submitting ? '正在提交…' : needsLogin ? '登录后生成' : '生成换装视频'}<span aria-hidden="true">↗</span></button></div>
            {(error || accountError) && <p role="alert" className={s.error}>{error ?? accountError}</p>}
          </div>
        </section></PreviewSurface>
      </div>
      <footer className={base['creation-footer']}><Link href="/privacy#video" target="_blank" rel="noopener noreferrer">隐私与使用说明 ↗</Link><VideoHistory owner={account?.user?.id ?? null} onSelect={(item) => { setSelected(item); setShowResult(item.state === 'completed' && !item.expired); setResultFailed(false); }} onChanged={async (item) => { setSelected((current) => current?.id === item.id ? item.archived ? null : { ...current, ...item } : current); await load(); }} /></footer>
    </main>
    {login && <AccountDialog purpose="video" account={account} onClose={() => setLogin(false)} onChanged={async () => { await refresh(); setLogin(false); }} onLogout={logout} />}
  </div>;
}
