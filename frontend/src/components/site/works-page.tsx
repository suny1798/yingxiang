'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteShell, useSiteAccount } from './site-shell';
import { useI18n } from '@/components/preferences';
import { notify } from '@/lib/notices';
import { useOrientedDownload } from '@/hooks/use-oriented-download';
import { MirrorButton } from '../studio/mirror-button';
import { MediaTools } from '../studio/media-tools';
import { Icon } from '../studio/icon';
import { WorkPrompts } from './work-prompts';
import type { WorkItem, WorkPage } from '@/lib/api-schema';
import s from './works-page.module.css';

const kinds = { all: '全部作品', realtime: '实时换装', video: '视频换装', edit: '实时编辑' } as const;
const states = { capturing: '正在生成并保存', waiting: '生成中', saving: '后台保存中', ready: '已保存', failed: '保存未完成' } as const;
type Kind = keyof typeof kinds;
type Sort = 'newest' | 'oldest' | 'title';
async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? '作品暂时无法读取，请稍后重试。');
  return value as T;
}

function FavoriteButton({ favorite, busy, onToggle, className = '' }: { favorite: boolean; busy: boolean; onToggle: () => void; className?: string }) {
  const { t } = useI18n();
  return <button type="button" className={`${s.favoriteButton} ${className}`} aria-label={t(favorite ? '取消收藏' : '收藏作品')} aria-pressed={favorite} title={t(favorite ? '取消收藏' : '收藏作品')} disabled={busy} onClick={onToggle}><Icon name="star" /><span className={s.favoriteLabel}>{t(favorite ? '已收藏' : '收藏')}</span></button>;
}

function WorksContent() {
  const { t, intlLocale } = useI18n();
  const { account, error: accountError, openLogin } = useSiteAccount();
  const owner = account?.user?.id ?? null;
  const [kind, setKind] = useState<Kind>('all'), [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(''), [query, setQuery] = useState(''), [sort, setSort] = useState<Sort>('newest'), [favoritesOnly, setFavoritesOnly] = useState(false);
  const [data, setData] = useState<{ owner: string; value: WorkPage } | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<{ owner: string; item: WorkItem } | null>(null);
  const selected = selection?.owner === owner ? selection.item : null;
  const [mirrored, setMirrored] = useState(false);
  const orientedDownload = useOrientedDownload(selected?.contentUrl ?? null, selected?.title.replace(/[<>:"/\\|?*]/g, '_') || '映想-作品', owner);
  const dialog = useRef<HTMLDialogElement>(null), playerRef = useRef<HTMLDivElement>(null), mediaRef = useRef<HTMLVideoElement>(null);
  const [mediaReady, setMediaReady] = useState(false), [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [title, setTitle] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [busy, setBusy] = useState(false);
  const [referenceIndex, setReferenceIndex] = useState(0), [playbackError, setPlaybackError] = useState(false);
  const version = useRef(0);
  const current = useRef(owner); current.current = owner;
  const list = data?.owner === owner ? data.value : null;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!owner) return;
    const revision = version.current;
    const params = new URLSearchParams({ kind, page: String(page), pageSize: '9', sort });
    if (query) params.set('q', query);
    if (favoritesOnly) params.set('favorite', 'true');
    try {
      const value = await json<WorkPage>(await fetch(`/api/works?${params}`, { cache: 'no-store', signal }));
      if (signal?.aborted || revision !== version.current || current.current !== owner) return;
      setData({ owner, value }); setError(null);
      setSelection(previous => {
        if (previous?.owner !== owner) return null;
        const updated = value.items.find(item => item.id === previous.item.id);
        return updated ? { owner, item: updated } : previous;
      });
    } catch (cause) {
      if (!signal?.aborted && revision === version.current && current.current === owner) setError(cause instanceof Error ? cause.message : '作品读取失败。');
    } finally { if (!signal?.aborted && revision === version.current) setLoading(false); }
  }, [owner, kind, page, query, favoritesOnly, sort]);
  useEffect(() => {
    version.current++; setSelection(null); setConfirmDelete(false); setData(null); setError(null);
    if (!owner) return;
    const controller = new AbortController(); setLoading(true); void refresh(controller.signal);
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    const timer = setInterval(update, 5000);
    window.addEventListener('focus', update); window.addEventListener('yingxiang:works-changed', update);
    return () => { version.current++; controller.abort(); clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('yingxiang:works-changed', update); };
  }, [owner, refresh]);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const date = (value: string) => new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const open = (item: WorkItem) => {
    if (!owner) return;
    setSelection({ owner, item }); setTitle(item.title); setReferenceIndex(0); setPlaybackError(false); setMediaReady(false); setConfirmDelete(false); setMirrored(false);
  };
  const close = () => { orientedDownload.cancel(); dialog.current?.close(); setSelection(null); setConfirmDelete(false); };
  const change = async (body: { title: string } | { action: 'retry' | 'delete' }) => {
    if (!selected || !owner || busy) return;
    const id = selected.id, actor = owner;
    setBusy(true);
    try {
      const result = await json<WorkItem | { accepted: boolean }>(await fetch(`/api/works/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Work-Owner': actor }, body: JSON.stringify(body) }));
      if (current.current !== actor) return;
      if ('action' in body && body.action === 'delete') { close(); notify('作品及关联资料已删除。', 'success'); }
      else if ('id' in result) { setSelection({ owner: actor, item: result }); notify('title' in body ? '作品名称已更新。' : '已重新保存已有结果，不会重新生成。', 'success'); }
      await refresh();
    } catch (cause) { if (current.current === actor) notify(cause instanceof Error ? cause.message : '作品操作未完成。', 'error'); }
    finally { setBusy(false); }
  };
  const toggleFavorite = async (item: WorkItem) => {
    if (!owner || favoriteBusy) return;
    const actor = owner;
    setFavoriteBusy(item.id);
    try {
      const result = await json<WorkItem>(await fetch(`/api/works/${item.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Work-Owner': actor }, body: JSON.stringify({ favorite: !item.favorite }) }));
      if (current.current !== actor) return;
      setData(previous => previous?.owner === actor ? { owner: actor, value: { ...previous.value, items: previous.value.items.map(value => value.id === result.id ? result : value) } } : previous);
      setSelection(previous => previous?.owner === actor && previous.item.id === result.id ? { owner: actor, item: result } : previous);
      notify(result.favorite ? '已加入收藏，可通过“仅看收藏”找到它。' : '已取消收藏，作品仍保留在全部作品中。', 'success');
      await refresh();
    } catch (cause) { if (current.current === actor) notify(cause instanceof Error ? cause.message : '收藏状态未能更新。', 'error'); }
    finally { setFavoriteBusy(null); }
  };
  const clearFilters = () => { setKind('all'); setSearchInput(''); setQuery(''); setSort('newest'); setFavoritesOnly(false); setPage(1); };
  const hasFilters = Boolean(query || favoritesOnly);
  return <main className={s.page}>
    <header className={s.heading}><div><p>{t('映想 · 作品存档')}</p><h1>{t('我的作品')}<span aria-hidden="true">✳</span></h1><p>{t('查看已保存的视频、服装参考图与提示词记录。')}</p></div><Link href="/studio" prefetch={false} className={s.primary}>{t('继续创作')}<span aria-hidden="true">↗</span></Link></header>
    <div className={s.toolbar}><div role="group" aria-label={t('作品分类')}>{Object.entries(kinds).map(([key, label]) => <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key as Kind); setPage(1); }}>{t(label)}</button>)}</div><span>{t('生成视频与服装参考图自动保存')}</span></div>
    {owner && <div className={s.indexBar}><form className={s.search} role="search" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(searchInput.trim()); }}><Icon name="search" /><input type="search" value={searchInput} maxLength={60} aria-label={t('按作品名称搜索')} placeholder={t('搜索作品名称…')} onChange={event => setSearchInput(event.target.value)} /><button type="submit">{t('搜索')}</button>{query && <button type="button" className={s.clearSearch} onClick={() => { setSearchInput(''); setQuery(''); setPage(1); }}>{t('清除')}</button>}</form><div className={s.indexActions}><label className={s.sort}><Icon name="sort" /><span className={s.visuallyHidden}>{t('作品排序')}</span><select aria-label={t('作品排序')} value={sort} onChange={event => { setSort(event.target.value as Sort); setPage(1); }}><option value="newest">{t('最新创建')}</option><option value="oldest">{t('最早创建')}</option><option value="title">{t('按名称排序')}</option></select></label><button type="button" className={s.favoritesFilter} aria-pressed={favoritesOnly} onClick={() => { setFavoritesOnly(value => !value); setPage(1); }}><Icon name="star" />{t('仅看收藏')}</button></div></div>}
    {!account && !accountError ? <div className={s.empty} role="status">{t('正在读取账号…')}</div> : !owner ? <div className={s.empty}><span aria-hidden="true">✳</span><h2>{t('登录后查看作品')}</h2><p>{t(accountError ?? '作品按账号独立保存，登录后可回放和下载。')}</p><button className={s.primary} onClick={openLogin} type="button">{t('登录 / 注册')}</button></div>
      : loading && !list ? <div className={s.empty} role="status">{t('正在整理你的作品…')}</div>
      : error && !list ? <div className={s.empty} role="alert"><h2>{t('暂时无法读取作品')}</h2><p>{t(error)}</p><button type="button" className={s.primary} onClick={() => { setLoading(true); void refresh(); }}>{t('重新加载')}</button></div>
      : !list?.total ? <div className={s.empty}><span className={s.emptyFrame} aria-hidden="true">{hasFilters ? '✳' : '▷'}</span><h2>{t(hasFilters ? '没有找到匹配的作品。' : kind === 'all' ? '暂无作品' : '这个分类暂无作品。')}</h2><p>{t(hasFilters ? favoritesOnly && !query ? '当前分类没有已收藏作品，可取消“仅看收藏”后查看全部。' : '请尝试其他名称，或清除搜索与收藏条件。' : '完成一次创作后，生成视频与使用的服装参考图会显示在这里。')}</p>{hasFilters ? <button type="button" className={s.primary} onClick={clearFilters}>{t('清除筛选条件')}</button> : <Link className={s.primary} href={kind === 'video' ? '/studio/video' : kind === 'edit' ? '/studio/edit' : '/studio'} prefetch={false}>{t('进入创作空间')} ↗</Link>}</div>
      : <><div className={s.collectionHeading}><span>{t(hasFilters ? '筛选结果' : sort === 'title' ? '按名称浏览' : sort === 'oldest' ? '从最早开始' : '最近创作')}</span><span>{list.total} {t('件作品')}</span></div>{error && <p className={s.error} role="alert">{t(error)} <button type="button" onClick={() => void refresh()}>{t('刷新')}</button></p>}<div className={s.grid}>{list.items.map(item => <article className={s.card} key={item.id}>
        <button type="button" className={s.preview} onClick={() => open(item)} aria-label={`${t('查看作品')}：${item.title}`}>
          {item.contentUrl ? <video src={`${item.contentUrl}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <div className={s.pending}><span aria-hidden="true">{item.state === 'failed' ? '!' : '✳'}</span><span>{t(states[item.state])}</span></div>}
          <span className={s.badge}>{t(kinds[item.kind])}</span>{item.contentUrl && <span className={s.play} aria-hidden="true">▷</span>}<span className={s.length}>{item.seconds.toFixed(0)}s</span>
        </button><FavoriteButton favorite={item.favorite} busy={favoriteBusy !== null} className={s.cardFavorite} onToggle={() => void toggleFavorite(item)} /><div className={s.cardBody}><div className={s.title}><button type="button" onClick={() => open(item)}>{item.title}</button><span data-state={item.state}>{t(states[item.state])}</span></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time><div className={s.references}><div>{item.references.slice(0, 4).map(ref => <img src={ref.url} key={ref.id} alt="" loading="lazy" />)}</div><span>{item.references.length ? `${t('服装参考')} · ${item.references.length}` : t(item.kind === 'edit' ? '提示词创作' : '暂无服装参考图')}</span><button type="button" onClick={() => open(item)}>{t('查看')} ↗</button></div></div>
      </article>)}</div><nav className={s.pagination} aria-label={t('作品分页')}><button type="button" disabled={list.page === 1} onClick={() => setPage(list.page - 1)}>{t('上一页')}</button><span>{list.page} / {list.pages}</span><button type="button" disabled={list.page === list.pages} onClick={() => setPage(list.page + 1)}>{t('下一页')}</button></nav></>}
    <p className={s.footnote}>{t('保存完成的作品可随时回看；仅当前账号可访问，删除后将移除本站保存的文件。')}</p>
    {selected && <dialog ref={dialog} className={s.dialog} aria-labelledby="work-title" onCancel={close} onClose={() => setSelection(null)}><div className={s.dialogHeading}><div><p>{t(kinds[selected.kind])} · {date(selected.createdAt)}</p><h2 id="work-title">{selected.title}</h2></div><button type="button" onClick={close} aria-label={t('关闭作品详情')}>×</button></div><div className={s.detailGrid}><div ref={playerRef} data-preview-stage className={s.player}>{selected.contentUrl && !playbackError ? <video ref={mediaRef} key={selected.id} src={selected.contentUrl} data-mirrored={mirrored} controls controlsList="nodownload" playsInline preload="metadata" aria-label={t('作品视频')} onLoadedData={() => setMediaReady(true)} onError={() => { setMediaReady(false); setPlaybackError(true); }} /> : <div className={s.pending}><span aria-hidden="true">{selected.state === 'failed' || playbackError ? '!' : '✳'}</span><h3>{t(playbackError ? '视频暂时无法播放' : states[selected.state])}</h3>{playbackError && <button type="button" onClick={() => setPlaybackError(false)}>{t('重新加载')}</button>}</div>}<MediaTools targetRef={playerRef} getVideo={() => mediaRef.current} mirrored={mirrored} fileStem={selected.title} disabled={!mediaReady || playbackError} /></div>{selected.kind === 'edit' && owner ? <WorkPrompts key={selected.id} id={selected.id} owner={owner} saving={['capturing', 'waiting', 'saving'].includes(selected.state)} /> : <aside className={s.referencePanel}><h3>{t('服装参考')}<span>{selected.references.length}</span></h3>{selected.references.length ? <><a href={selected.references[Math.min(referenceIndex, selected.references.length - 1)].url} target="_blank" rel="noopener noreferrer" aria-label={t('查看参考图原图')}><img className={s.referenceLarge} src={selected.references[Math.min(referenceIndex, selected.references.length - 1)].url} alt={t('本次使用的服装参考图')} /></a><div className={s.referenceChoices} role="group" aria-label={t('选择服装参考图')}>{selected.references.map((ref, index) => <button type="button" key={ref.id} aria-pressed={referenceIndex === index} onClick={() => setReferenceIndex(index)} aria-label={`${t('服装参考图')} ${index + 1}`}><img src={ref.url} alt="" /></button>)}</div></> : <p>{t(selected.kind === 'edit' ? '本次使用提示词创作，没有服装参考图。' : '这件作品没有留存服装参考图。')}</p>}</aside>}</div>
      {selected.message && <p className={s.detailMessage} role="status">{t(selected.message)}</p>}<div className={s.detailsMeta}><span>{t(states[selected.state])} · {selected.extension.toUpperCase()}{selected.bytes > 0 && ` · ${(selected.bytes / 1024 / 1024).toFixed(1)} MB`}</span><div>{selected.canRetry && <button type="button" className={s.secondary} disabled={busy} onClick={() => void change({ action: 'retry' })}>{t('重试保存')}</button>}<FavoriteButton favorite={selected.favorite} busy={favoriteBusy !== null} className={s.detailFavorite} onToggle={() => void toggleFavorite(selected)} />{selected.contentUrl && <><MirrorButton mirrored={mirrored} disabled={orientedDownload.busy} onToggle={() => setMirrored(value => !value)} /><button type="button" className={s.primary} onClick={() => orientedDownload.busy ? orientedDownload.cancel() : void orientedDownload.download(mirrored)}>{t(orientedDownload.busy ? '取消导出' : '下载视频')} ↓</button></>}</div></div>
      <form className={s.rename} onSubmit={event => { event.preventDefault(); void change({ title }); }}><label htmlFor="work-name">{t('作品名称')}</label><input id="work-name" value={title} maxLength={60} required onChange={event => setTitle(event.target.value)} disabled={busy} /><button type="submit" className={s.secondary} disabled={busy || !title.trim() || title.trim() === selected.title}>{t('保存名称')}</button></form>
      <div className={s.deleteArea}>{confirmDelete ? <><p>{t(selected.kind === 'edit' ? '删除这件作品的视频和全部提示词记录？此操作无法恢复。' : '删除这件作品的视频和全部参考图？此操作无法恢复。')}</p><button type="button" className={s.secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>{t('取消')}</button><button type="button" className={s.danger} disabled={busy || orientedDownload.busy} onClick={() => void change({ action: 'delete' })}>{t(busy ? '正在删除…' : '确认删除')}</button></> : <button type="button" className={s.deleteButton} disabled={busy || orientedDownload.busy || ['capturing', 'waiting', 'saving'].includes(selected.state)} onClick={() => setConfirmDelete(true)}>{t('删除作品')}</button>}</div>
    </dialog>}
  </main>;
}

export function WorksPage() { return <SiteShell active="works"><WorksContent /></SiteShell>; }
