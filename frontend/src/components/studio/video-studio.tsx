'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../site/site-header';
import { StudioModes } from './studio-modes';
import { AccountDialog } from './account-dialog';
import { useAccount } from '@/hooks/use-account';
import { useGarmentInput } from '@/hooks/use-garment-input';
import type { Garment } from '@/lib/try-on/types';
import { inspectVideo } from '@/lib/video/mp4';
import { VIDEO_POLICY, VIDEO_STATE_LABEL, type VideoJobView, type VideoServiceView } from '@/lib/video/policy';
import base from './studio.module.css';
import s from './video-studio.module.css';

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
  const [consent, setConsent] = useState(false);
  const [service, setService] = useState<VideoServiceView | null>(null);
  const [selected, setSelected] = useState<VideoJobView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultFailed, setResultFailed] = useState(false);
  const [resultRevision, setResultRevision] = useState(0);
  const [showResult, setShowResult] = useState(false);
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
        setSelected((current) => value.jobs.find((job) => job.id === current?.id) ?? value.jobs[0] ?? null);
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
    return () => { alive.current = false; ++generation.current; ++validation.current; submitAbort.current?.abort(); if (videoUrl.current) URL.revokeObjectURL(videoUrl.current); };
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
          setSelected((value) => value?.id === job.id ? job : value);
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
  useEffect(() => { setShowResult(selected?.state === 'completed'); setResultFailed(false); }, [selected?.id, selected?.state]);
  const chooseVideo = async (file?: File) => {
    if (!file) return;
    const revision = ++validation.current; setValidating(true); setError(null);
    try {
      if (file.size > VIDEO_POLICY.maxBytes || !file.name.toLowerCase().endsWith('.mp4')) throw new Error('请选择不超过25MB的MP4视频。');
      const info = inspectVideo(new Uint8Array(await file.arrayBuffer()));
      if (!alive.current || revision !== validation.current) return;
      const url = URL.createObjectURL(file);
      if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
      videoUrl.current = url; setVideo({ file, url, seconds: info.seconds }); setConsent(false); setShowResult(false); attempt.current = null;
    } catch (cause) { if (alive.current && revision === validation.current) setError(cause instanceof Error ? cause.message : '视频无法读取。'); }
    finally { if (alive.current && revision === validation.current) setValidating(false); }
  };
  const removeVideo = () => {
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
      setSelected(job); setShowResult(job.state === 'completed'); await load();
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
  return <div className={base.studio}>
    <SiteHeader active="studio" account={account} onLogin={() => setLogin(true)} />
    <main className={`${base['page-shell']} ${base['creation-shell']}`}>
      <div className={base['workbench-title']}><h1>创作空间</h1><span>视频换装</span><Link href="/account" prefetch={false}>我的权益 ↗</Link></div>
      <StudioModes active="video" />
      <div className={s.layout}>
        <section className={s.inputs} aria-label="视频换装素材">
          <div className={s.fieldHeading}><h2>人物视频</h2><span>1—15秒</span></div>
          <input className={base['visually-hidden']} ref={videoInput} type="file" accept="video/mp4,.mp4" aria-label="选择人物视频" tabIndex={-1} onChange={(event) => { void chooseVideo(event.target.files?.[0]); event.target.value = ''; }} />
          <button type="button" className={s.videoUpload} disabled={submitting} onClick={() => videoInput.current?.click()}><span aria-hidden="true">▷</span><strong>{validating ? '正在检查视频…' : video ? '更换人物视频' : '选择一段人物视频'}</strong><small>MP4 · H.264 · 无音轨 · ≤25MB</small></button>
          {video && <div className={s.fileRow}><span title={video.file.name}>{video.file.name}</span><span>{video.seconds.toFixed(1)}秒</span><button type="button" disabled={submitting} onClick={removeVideo}>移除</button></div>}
          <div className={s.fieldHeading}><h2>服装参考图</h2><span>本次使用一张</span></div>
          <input className={base['visually-hidden']} ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择视频换装服装图" tabIndex={-1} onChange={(event) => { void images.uploadMany(Array.from(event.target.files ?? [])); event.target.value = ''; setConsent(false); }} />
          <button type="button" disabled={submitting || images.processing || images.garments.length >= 6} className={s.imageUpload} onClick={() => imageInput.current?.click()}>{selectedImage ? <img src={selectedImage.previewUrl} alt="本次换装服装参考图" /> : <><span aria-hidden="true">＋</span><strong>选择服装图片</strong><small>JPG / PNG / WebP · ≤10MB</small></>}</button>
          {!!images.garments.length && <div className={s.wardrobe} role="group" aria-label="视频服装选择">{images.garments.map((item, index) => <div key={item.id}><button type="button" disabled={submitting} aria-pressed={item.id === images.selectedId} aria-label={`使用服装${index + 1}`} onClick={() => { images.select(item.id); setConsent(false); }}><img src={item.previewUrl} alt="" /></button><button type="button" disabled={submitting} className={s.removeImage} aria-label={`移除视频服装${index + 1}`} onClick={() => { images.remove(item.id); setConsent(false); }}>×</button></div>)}{images.garments.length < 6 && <button type="button" disabled={submitting || images.processing} aria-label="添加视频服装图" onClick={() => imageInput.current?.click()}>＋</button>}</div>}
          {images.processing && <p role="status" className={s.note}>图片处理中…</p>}
          {images.error && <p role="alert" className={s.error}>{images.error}</p>}
          <p className={s.note}>横版16:9 / 2:1，竖版9:16 / 1:2。含声音的视频请先移除音轨后导出。</p>
        </section>
        <section className={s.output} aria-labelledby="video-preview-title">
          <div className={s.outputHeading}><h2 id="video-preview-title">{showResult && resultUrl ? '换装结果' : '视频预览'}</h2><span>{selected ? selected.expired ? '访问已过期' : VIDEO_STATE_LABEL[selected.state] : video ? '本地预览' : '等待素材'}</span></div>
          <div className={s.stage}>
            {showResult && resultUrl ? resultFailed ? <div className={s.empty}><p>暂时无法播放结果</p><button type="button" onClick={() => { setResultFailed(false); setResultRevision((value) => value + 1); }}>重新加载</button></div> : <video key={resultUrl} src={resultUrl} controls playsInline preload="metadata" onError={() => setResultFailed(true)} aria-label="生成的换装视频" /> : video ? <video key={video.url} src={video.url} controls muted playsInline preload="metadata" aria-label="本地人物视频预览" /> : <div className={s.empty}><span aria-hidden="true" className={s.filmFrame}>▷</span><h3>把新的穿搭，带进这段画面。</h3><p>选一段人物视频，再放入喜欢的服装。</p><button type="button" onClick={() => videoInput.current?.click()}>选择人物视频 ↗</button></div>}
            {selected && inProgress(selected) && <div role="status" className={s.processing}><span className={s.spinner} aria-hidden="true" />{VIDEO_STATE_LABEL[selected.state]}<small>可离开页面，稍后回来查看</small></div>}
          </div>
          <div className={s.previewActions}><div className={s.switch}><button type="button" aria-pressed={!showResult} disabled={!video} onClick={() => setShowResult(false)}>原视频</button><button type="button" aria-pressed={showResult} disabled={!resultUrl} onClick={() => setShowResult(true)}>换装结果</button></div>{resultUrl && <a href={`${resultUrl}&download=1`} className={s.download}>下载 MP4 ↓</a>}</div>
          <div className={s.submitArea}>
            <details className={s.privacy}><summary>云端处理与任务说明</summary><p>提交后，人物视频和当前服装图将经映想服务端发送到Decart，进行视频换装。请确认素材使用权及出镜者同意。仅接受无音轨视频；本机不保存输入或结果媒体，只保存任务元数据。</p><p>离开页面不会取消已提交的云端任务。任务提交不确定时需核查，不能重复生成。结果访问窗口为提交后24小时，供应商留存和可下载期限以其政策及实际返回为准，请及时下载。视频额度独立于实时免费体验，当前尚未开放购买。</p></details>
            <label className={s.consent}><input type="checkbox" checked={consent} disabled={submitting} onChange={(event) => setConsent(event.target.checked)} /><span>我已阅读说明，同意将这段视频与服装图发送至Decart处理。</span></label>
            <div className={s.submitRow}><p>{service?.message ?? '正在读取视频服务…'}<small>{video ? `输入${video.seconds.toFixed(1)}秒 · 不占实时体验次数` : '选择素材仅在本地预览'}</small></p><button type="button" className={s.generate} disabled={!canSubmit} onClick={() => void submit()}>{submitting ? '正在提交…' : needsLogin ? '登录后生成' : '生成换装视频'}<span aria-hidden="true">↗</span></button></div>
            {(error || accountError) && <p role="alert" className={s.error}>{error ?? accountError}</p>}
          </div>
        </section>
      </div>
      <section className={s.jobs} aria-labelledby="video-tasks-title"><div className={s.fieldHeading}><h2 id="video-tasks-title">我的视频任务</h2><button type="button" disabled={submitting} onClick={() => void refreshJobs()}>刷新任务 ↻</button></div>{service?.jobs.length ? <ul>{service.jobs.map((job) => <li key={job.id}><button type="button" aria-pressed={job.id === selected?.id} onClick={() => { setSelected(job); setShowResult(job.state === 'completed' && !job.expired); }}><span>视频换装<small>{new Date(job.createdAt).toLocaleString('zh-CN')} · {job.seconds.toFixed(1)}秒</small></span><span>{job.expired ? '访问已过期' : VIDEO_STATE_LABEL[job.state]}<small>{job.state === 'unknown' ? '请联系开发者核查' : job.state === 'completed' && !job.expired ? '查看结果 ↗' : '不自动重复生成'}</small></span></button></li>)}</ul> : <p className={s.note}>{account?.user ? '还没有视频任务。生成后可以在这里查看进度和结果。' : '登录后查看你的视频任务，素材可以先准备。'}</p>}</section>
    </main>
    {login && <AccountDialog purpose="video" account={account} onClose={() => setLogin(false)} onChanged={async () => { await refresh(); setLogin(false); }} onLogout={async () => { const response = await fetch('/api/account/logout', { method: 'POST' }); if (!response.ok) throw new Error(); await refresh(); }} />}
  </div>;
}
