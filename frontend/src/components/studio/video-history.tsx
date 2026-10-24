'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VideoHistoryItem, VideoHistoryPage } from '@/lib/api-schema';
import { VIDEO_STATE_LABEL } from '@/lib/video/policy';
import { notify } from '@/lib/notices';
import { useNotice } from '@/hooks/use-notice';
import { Icon } from './icon';
import s from './video-history.module.css';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? '历史记录读取失败，请稍后重试。');
  return body as T;
}

export function VideoHistory({ owner, onSelect, onChanged }: { owner: string | null; onSelect: (item: VideoHistoryItem) => void; onChanged: (item: VideoHistoryItem) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [open, setOpen] = useState(false), [archived, setArchived] = useState(false), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [data, setData] = useState<VideoHistoryPage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null), generation = useRef(0);
  useNotice(error);
  useEffect(() => {
    ++generation.current; mutation.current?.abort(); mutation.current = null;
    dialog.current?.close(); setOpen(false); setData(null); setEditing(null); setBusy(null); setPage(1); setArchived(false);
    return () => { ++generation.current; mutation.current?.abort(); mutation.current = null; };
  }, [owner]);
  useEffect(() => {
    if (!open || !owner) return;
    const controller = new AbortController(), current = generation.current;
    setLoading(true); setError(null); setData(null);
    void fetch(`/api/video/history?archived=${archived}&page=${page}&pageSize=3`, { signal: controller.signal, cache: 'no-store' }).then(json<VideoHistoryPage>).then((value) => {
      if (controller.signal.aborted || current !== generation.current) return;
      setData(value); if (value.page !== page) setPage(value.page);
    }).catch((cause) => { if (!controller.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : '历史记录读取失败。'); }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [owner, open, archived, page, reload]);
  const change = async (item: VideoHistoryItem, body: { title?: string; archived?: boolean }) => {
    if (mutation.current || !owner) return;
    if (body.title !== undefined && !body.title.trim()) { notify('请输入视频名称。', 'error'); return; }
    const controller = new AbortController(), current = generation.current;
    mutation.current = controller; setBusy(item.id); setError(null);
    try {
      const updated = await json<VideoHistoryItem>(await fetch(`/api/video/jobs/${item.id}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }));
      if (controller.signal.aborted || current !== generation.current) return;
      await onChanged(updated);
      if (controller.signal.aborted || current !== generation.current) return;
      setEditing(null); setReload((value) => value + 1);
      notify(body.title !== undefined ? '视频名称已更新。' : body.archived ? '视频已归档，可在“已归档”中恢复。' : '视频已恢复到历史记录。', 'success');
    } catch (cause) { if (!controller.signal.aborted && current === generation.current) notify(cause instanceof Error ? cause.message : '历史记录更新失败，请刷新核查。', 'error'); }
    finally { if (mutation.current === controller) { mutation.current = null; if (current === generation.current) setBusy(null); } }
  };
  const close = () => { dialog.current?.close(); setOpen(false); setEditing(null); };
  return <>
    <button type="button" className={s.trigger} disabled={!mounted} aria-label="历史视频" onClick={() => { setOpen(true); dialog.current?.showModal(); }}><Icon name="history" />历史视频<span>↗</span></button>
    {mounted && createPortal(<dialog ref={dialog} className={s.dialog} aria-labelledby={titleId} onClose={() => { setOpen(false); setEditing(null); }}>
      <header className={s.header}><div><span className={s.eyebrow}>映想 · 你的创作</span><h2 id={titleId}>历史视频</h2></div><button type="button" className={s.close} aria-label="关闭历史记录" onClick={close}>×</button></header>
      <p className={s.description}>主动选择后才会加载视频。结果访问窗口为24小时，请及时下载保存。</p>
      {!owner ? <div className={s.empty}><Icon name="lock" /><h3>登录后查看历史视频</h3><p>你的生成记录会跟随账号保存。</p></div> : <>
        <div className={s.toolbar}><div className={s.tabs} role="group" aria-label="历史记录分类"><button type="button" aria-pressed={!archived} disabled={!!busy} onClick={() => { setArchived(false); setPage(1); setEditing(null); }}>视频记录</button><button type="button" aria-pressed={archived} disabled={!!busy} onClick={() => { setArchived(true); setPage(1); setEditing(null); }}>已归档</button></div><button className={s.refresh} type="button" disabled={loading || !!busy} onClick={() => setReload((value) => value + 1)}>刷新记录 ↻</button></div>
        {loading ? <div role="status" className={s.empty}><p>正在读取历史记录…</p></div> : error ? <div role="alert" className={s.empty}><p>{error}</p><button type="button" className={s.retry} onClick={() => setReload((value) => value + 1)}>重新读取</button></div> : data?.items.length ? <ul className={s.list}>{data.items.map((item) => {
          const expired = item.expired || Date.parse(item.expiresAt) <= Date.now();
          return <li key={item.id} className={s.item}><div className={s.poster} aria-hidden="true">▷</div><div className={s.details}>
            {editing?.id === item.id ? <form className={s.rename} onSubmit={(event) => { event.preventDefault(); void change(item, { title: editing.title }); }}><input autoFocus aria-label="视频名称" value={editing.title} maxLength={60} disabled={!!busy} onChange={(event) => setEditing({ id: item.id, title: event.target.value })} /><div><button type="submit" disabled={!!busy}>保存名称</button><button type="button" disabled={!!busy} onClick={() => setEditing(null)}>取消</button></div></form> : <><div className={s.itemHeading}><h3 title={item.title}>{item.title}</h3><span className={s.badge} data-state={expired ? 'expired' : item.state}>{expired ? '已过期' : VIDEO_STATE_LABEL[item.state]}</span></div><p className={s.meta}>{new Date(item.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}<span> · {item.seconds.toFixed(1)}秒</span></p><div className={s.actions}>
              <button type="button" className={s.view} disabled={!!busy || expired || item.archived || item.state !== 'completed'} onClick={() => { close(); onSelect(item); }}>{expired ? '结果已过期' : item.archived ? '恢复后查看' : item.state === 'completed' ? '查看 / 下载' : '等待任务结果'}</button>
              <button type="button" disabled={!!busy} onClick={() => setEditing({ id: item.id, title: item.title })}>重命名</button>
              <button type="button" disabled={!!busy || (!item.archived && !['completed', 'failed'].includes(item.state))} title={['completed', 'failed'].includes(item.state) ? undefined : '任务完成或失败后可归档'} onClick={() => void change(item, { archived: !item.archived })}>{busy === item.id ? '正在保存…' : item.archived ? '恢复' : '归档'}</button>
            </div></>}
          </div></li>;
        })}</ul> : <div className={s.empty}><Icon name="history" /><h3>{archived ? '还没有归档的视频' : '还没有历史视频'}</h3><p>{archived ? '归档的记录会放在这里，随时可以恢复。' : '完成一次视频换装后，可以在这里查看和整理。'}</p></div>}
        <footer className={s.footer}><span>归档后可恢复</span><nav aria-label="历史记录分页"><button type="button" disabled={loading || !!busy || (data?.page ?? page) <= 1} onClick={() => { setPage((value) => value - 1); setEditing(null); }}>上一页</button><span>{data?.page ?? page} / {data?.pages ?? 1}</span><button type="button" disabled={loading || !!busy || (data?.page ?? page) >= (data?.pages ?? 1)} onClick={() => { setPage((value) => value + 1); setEditing(null); }}>下一页</button></nav></footer>
      </>}
    </dialog>, document.body)}
  </>;
}
