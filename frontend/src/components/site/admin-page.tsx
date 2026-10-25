'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '@/components/preferences';
import { notify } from '@/lib/notices';
import type { AdminUsers, AdminUser, AdminRecords, AuditPage, Overview, AdminSettings } from '@/lib/api-schema';
import { SiteShell, useSiteAccount } from './site-shell';
import s from './admin.module.css';

type Tab = 'overview' | 'users' | 'usage' | 'video' | 'orders' | 'settings' | 'audit';
type Pending = { path: string; body: Record<string, unknown>; summary: string };
type Say = (zh: string, en: string) => string;

class AdminError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new AdminError(value.error?.message ?? '管理请求未完成。', response.status);
  return value as T;
}

function useData<T>(path: string, revision: number) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: '', loading: true });
    void api<T>(path, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, error: '', loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ data: null, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [path, revision]);
  return state;
}

export function AdminPage() { return <SiteShell active="admin"><AdminAccess /></SiteShell>; }

function AdminAccess() {
  const { account, error, openLogin, refresh } = useSiteAccount();
  const { locale } = useI18n();
  const say: Say = (zh, en) => locale === 'en' ? en : zh;
  if (!account) return <main className={s.page}>{error ? <section className={s.panel}><p role="alert">{error}</p><button className={s.button} onClick={() => void refresh()}>{say('重新核验', 'Check again')}</button></section> : <p className={s.empty}>{say('正在核验管理员身份…', 'Checking administrator access…')}</p>}</main>;
  if (account.user?.role !== 'admin') return <main className={s.page}><section className={s.panel}><h1>{say('这里需要管理员权限', 'Administrator access required')}</h1><p className={s.muted}>{say('此页面仅供项目管理员使用。普通账号无法读取或修改管理数据。', 'Only project administrators can use this page. Regular accounts cannot read or change administrative data.')}</p><div className={s.toolbar}>{!account.user && <button className={s.primary} onClick={openLogin}>{say('登录账号', 'Sign in')}</button>}<Link href="/" className={s.button}>{say('返回首页', 'Back to home')}</Link></div></section></main>;
  return <AdminConsole key={account.user.id} username={account.user.username} say={say} refreshAccount={refresh} />;
}

function AdminConsole({ username, say, refreshAccount }: { username: string; say: Say; refreshAccount: () => Promise<unknown> }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const lock = useRef(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current?.abort(); }, []);
  const prepare = (value: Pending) => { if (!lock.current) { setError(''); setPending(value); } };
  const save = async () => {
    if (!pending || lock.current || !lifetime.current) return;
    lock.current = true;
    setBusy(true); setError('');
    const signature = JSON.stringify(pending);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      await api(pending.path, lifetime.current.signal, { ...pending.body, requestId: operation.current.id });
      if (lifetime.current.signal.aborted) return;
      setPending(null); setRevision(value => value + 1); operation.current = null;
      notify(say('管理修改已保存并记录操作日志。', 'Changes saved and recorded in the audit log.'), 'success');
      void refreshAccount();
    } catch (value) {
      if (lifetime.current.signal.aborted) return;
      const message = value instanceof Error ? value.message : say('管理请求未完成。', 'The request could not be completed.');
      if (value instanceof AdminError && [401, 403].includes(value.status)) { setDenied(true); setPending(null); void refreshAccount(); }
      setError(message);
      notify(message, 'error');
    } finally {
      lock.current = false;
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  };
  const tabs: [Tab, string][] = [['overview', say('项目总览', 'Overview')], ['users', say('用户与权益', 'Users & access')], ['usage', say('实时使用记录', 'Live usage')], ['video', say('视频任务', 'Video tasks')], ['orders', say('沙盒订单', 'Sandbox orders')], ['settings', say('服务与内容', 'Services & content')], ['audit', say('操作日志', 'Audit log')]];
  return <main className={s.page}>
    <header className={s.heading}><div><p>{say('映想 · 项目管理', 'Yingxiang · Administration')}</p><h1>{say('管理后台', 'Admin console')}</h1></div><div className={s.toolbar}><p><span>{username}</span> · {say('管理员', 'Administrator')}</p><button type="button" className={s.button} disabled={busy} onClick={() => { setRevision(value => value + 1); void refreshAccount(); }}>{say('刷新数据', 'Refresh data')}</button></div></header>
    {denied ? <section className={s.panel}><h2>{say('管理权限已失效', 'Administrator access has ended')}</h2><p>{say('请重新登录并核对账号权限。管理数据已隐藏。', 'Sign in again and check your access. Administrative data is hidden.')}</p></section> : <div className={s.layout}>
      <nav className={s.nav} aria-label={say('后台导航', 'Admin navigation')}>{tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} disabled={busy} onClick={() => { setTab(key); setError(''); }}>{label}</button>)}</nav>
      <div>{error && !pending && <div className={s.error} role="alert">{error}</div>}
        {tab === 'overview' && <OverviewPanel revision={revision} say={say} />}
        {tab === 'users' && <UsersPanel revision={revision} say={say} prepare={prepare} />}
        {(['usage', 'video', 'orders'] as Tab[]).includes(tab) && <RecordsPanel key={tab} kind={tab as 'usage' | 'video' | 'orders'} revision={revision} say={say} />}
        {tab === 'settings' && <SettingsPanel revision={revision} say={say} prepare={prepare} />}
        {tab === 'audit' && <AuditPanel revision={revision} say={say} />}
      </div>
    </div>}
    {pending && <Confirm pending={pending} busy={busy} error={error} say={say} close={() => { if (!lock.current) setPending(null); }} save={() => void save()} />}
  </main>;
}

function LoadState({ loading, error, say, children }: { loading: boolean; error: string; say: Say; children: ReactNode }) {
  if (loading) return <div className={s.panel} role="status">{say('正在读取…', 'Loading…')}</div>;
  if (error) return <div className={s.error} role="alert">{error}</div>;
  return <>{children}</>;
}

function OverviewPanel({ revision, say }: { revision: number; say: Say }) {
  const { data, loading, error } = useData<Overview>('/api/admin/overview', revision);
  return <LoadState loading={loading} error={error} say={say}>{data && <>
    <div className={s.stats}>{[[data.users, say('注册用户', 'Users')], [data.videoJobs, say('视频任务', 'Video tasks')], [data.usageAttempts, say('实时申请', 'Live requests')], [data.unknownResults, say('结果待核查', 'Unknown outcomes')]].map(([count, label]) => <div className={s.stat} key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
    <section className={s.panel}><h2>{say('服务运行边界', 'Service boundaries')}</h2><div className={s.notice}>{say('后台权限与生成权益分开。恢复服务不会提高原有预算、解除测试账号限制或清空历史占用；现有任务不会因暂停新生成而被取消。', 'Admin access is separate from generation entitlements. Resuming services does not increase budgets, remove test-account restrictions, or reset usage. Pausing new requests does not cancel existing tasks.')}</div><div className={s.tableWrap}><table className={s.table}><thead><tr>{[say('功能', 'Feature'), say('配置状态', 'Configuration'), say('后台暂停', 'Admin pause'), say('预留 / 预算 USD', 'Reserved / budget USD'), say('申请数 / 上限', 'Requests / limit')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.services.map(row => <tr key={row.scene}><td>{sceneName(row.scene, say)}</td><td>{row.configured ? say('已配置', 'Configured') : say('未就绪', 'Not ready')}</td><td>{row.paused ? say('已暂停', 'Paused') : say('未暂停', 'Not paused')}</td><td>{row.budgetUsd === null ? '—' : `${row.reservedUsd.toFixed(2)} / ${row.budgetUsd.toFixed(2)}`}</td><td>{row.requests} / {row.maxRequests ?? '—'}</td></tr>)}</tbody></table></div></section>
    <section className={s.panel}><h2>{say('账号与支付', 'Accounts & payments')}</h2><p className={s.muted}>{say('可用管理员', 'Active admins')} {data.admins} · {say('已暂停账号', 'Suspended accounts')} {data.disabledUsers} · {say('沙盒订单', 'Sandbox orders')} {data.sandboxOrders}</p><p>{say('Stripe 沙盒', 'Stripe sandbox')}：{data.sandboxEnabled ? say('已开放', 'Enabled') : say('未开放', 'Disabled')} · {say('正式支付未开放', 'Live payments are disabled')}</p></section>
  </>}</LoadState>;
}

function sceneName(scene: string, say: Say) {
  return ({ studio: say('实时换装', 'Live try-on'), prompt: say('实时编辑', 'Live editing'), video: say('视频换装', 'Video try-on'), stripe_sandbox: say('Stripe 沙盒', 'Stripe sandbox') } as Record<string, string>)[scene] ?? scene;
}

function stateName(state: string, say: Say) {
  return ({ reserved: say('已预留', 'Reserved'), unknown: say('待核查', 'Unknown'), issued: say('已签发', 'Issued'), finished: say('已结束', 'Finished'), submitting: say('提交中', 'Submitting'), pending: say('待处理', 'Pending'), processing: say('处理中', 'Processing'), completed: say('已完成', 'Completed'), failed: say('失败', 'Failed'), creating: say('创建中', 'Creating'), paid: say('已支付', 'Paid'), expired: say('已过期', 'Expired') } as Record<string, string>)[state] ?? state;
}

function Pager({ page, pages, total, setPage, say }: { page: number; pages: number; total: number; setPage: (value: number) => void; say: Say }) {
  return <div className={s.pagination}><span>{total} {say('条', 'records')} · {page} / {pages}</span><button className={s.button} disabled={page <= 1} onClick={() => setPage(page - 1)}>{say('上一页', 'Previous')}</button><button className={s.button} disabled={page >= pages} onClick={() => setPage(page + 1)}>{say('下一页', 'Next')}</button></div>;
}

function Search({ submit, say, children }: { submit: (value: string) => void; say: Say; children?: ReactNode }) {
  return <form className={s.toolbar} onSubmit={event => { event.preventDefault(); submit(String(new FormData(event.currentTarget).get('query') ?? '').trim()); }}><label className={`${s.field} ${s.search}`}>{say('搜索账号或记录编号', 'Search account or record ID')}<input name="query" maxLength={80} /></label>{children}<button className={s.primary} type="submit">{say('查询', 'Search')}</button></form>;
}

function UsersPanel({ revision, say, prepare }: { revision: number; say: Say; prepare: (value: Pending) => void }) {
  const { intlLocale } = useI18n();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const { data, loading, error } = useData<AdminUsers>(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`, revision);
  useEffect(() => { setSelected(null); }, [revision]);
  return <><section className={s.panel}><h2>{say('用户与体验权益', 'Users & trial entitlements')}</h2><Search say={say} submit={value => { setQuery(value); setPage(1); setSelected(null); }} /><LoadState loading={loading} error={error} say={say}>{data && <><div className={s.tableWrap}><table className={s.table}><thead><tr>{[say('账号', 'Account'), say('角色 / 状态', 'Role / status'), say('可用体验次数', 'Available sessions'), say('操作', 'Actions')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map(user => <tr key={user.id}><td>{user.username}<small>{new Date(user.createdAt).toLocaleDateString(intlLocale)}</small></td><td><span className={s.badge}>{user.role === 'admin' ? say('管理员', 'Admin') : say('普通用户', 'User')}</span><small>{user.disabled ? say('已暂停', 'Suspended') : say('正常', 'Active')}</small></td><td>{user.durations.map(item => <div key={item.seconds}>{item.seconds}s：{item.remaining.toLocaleString(intlLocale)} / {item.limit.toLocaleString(intlLocale)}</div>)}</td><td><button className={s.button} onClick={() => setSelected(user)}>{say('管理', 'Manage')}</button></td></tr>)}</tbody></table></div>{!data.items.length && <p className={s.empty}>{say('没有找到账号', 'No accounts found')}</p>}<Pager {...data} setPage={setPage} say={say} /></>}</LoadState></section>{selected && <UserEditor key={selected.id} user={selected} say={say} prepare={prepare} close={() => setSelected(null)} />}</>;
}

function UserEditor({ user, say, prepare, close }: { user: AdminUser; say: Say; prepare: (value: Pending) => void; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  const get = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
  return <section ref={panel} tabIndex={-1} className={s.panel} aria-label={`${say('管理账号', 'Manage account')} ${user.username}`}><div className={s.heading}><h2>{say('管理账号', 'Manage account')} · {user.username}</h2><button className={s.button} onClick={close}>{say('收起', 'Close')}</button></div><div className={s.grid}>
    <form className={s.stack} onSubmit={event => { const form = get(event); const role = form.get('role'); const disabled = form.get('disabled') === 'on'; const reason = String(form.get('reason')).trim(); prepare({ path: `/api/admin/users/${user.id}`, body: { role, disabled, reason }, summary: `${user.username}\n${say('角色', 'Role')}: ${role}\n${disabled ? say('暂停账号并撤销会话', 'Suspend account and revoke sessions') : say('账号正常', 'Account active')}\n${reason}` }); }}><h3>{say('角色与状态', 'Role & status')}</h3><label className={s.field}>{say('角色', 'Role')}<select name="role" defaultValue={user.role}><option value="user">{say('普通用户', 'User')}</option><option value="admin">{say('管理员', 'Admin')}</option></select></label><label className={s.check}><input type="checkbox" name="disabled" defaultChecked={user.disabled} />{say('暂停此账号', 'Suspend this account')}</label><p className={s.muted}>{say('角色变更会撤销该用户旧会话，需重新登录。不能暂停自己或撤销自己的管理权限。', 'Role changes revoke the user’s old sessions and require signing in again. You cannot suspend or demote yourself.')}</p><Reason say={say} /><button className={s.primary}>{say('核对账号修改', 'Review account changes')}</button></form>
    <form className={s.stack} onSubmit={event => { const form = get(event); const seconds = Number(form.get('seconds')); const delta = Number(form.get('delta')); const reason = String(form.get('reason')).trim(); prepare({ path: `/api/admin/users/${user.id}/quota`, body: { seconds, delta, reason }, summary: `${user.username}\n${seconds}s · ${delta > 0 ? '+' : ''}${delta} ${say('次实时换装体验', 'live try-on sessions')}\n${reason}` }); }}><h3>{say('调整实时换装次数', 'Adjust live try-on sessions')}</h3><div className={s.grid}><label className={s.field}>{say('时长', 'Duration')}<select name="seconds">{[15, 30, 60].map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}</select></label><label className={s.field}>{say('增减次数', 'Change in sessions')}<input name="delta" type="number" required min={-1000000} max={1000000} step={1} defaultValue={1} /></label></div><p className={s.muted}>{say('正数增加，负数回收未用次数。不能修改已用或预留记录；不会提高视频/编辑预算、改变测试名单或把沙盒积分转成真实权益。', 'Positive values grant sessions; negative values reclaim unused sessions. Used and reserved sessions stay intact. Video/editing budgets, test access lists, and sandbox isolation do not change.')}</p><Reason say={say} /><button className={s.primary}>{say('核对权益调整', 'Review entitlement changes')}</button></form>
  </div></section>;
}

function Reason({ say }: { say: Say }) { return <label className={s.field}>{say('操作原因（必填）', 'Reason (required)')}<input name="reason" required minLength={3} maxLength={200} placeholder={say('至少3字，不填写密码或密钥', 'At least 3 characters. Do not include credentials.')} /></label>; }

function RecordsPanel({ kind, revision, say }: { kind: 'usage' | 'video' | 'orders'; revision: number; say: Say }) {
  const { intlLocale } = useI18n();
  const [query, setQuery] = useState(''); const [state, setState] = useState(''); const [page, setPage] = useState(1);
  const { data, loading, error } = useData<AdminRecords>(`/api/admin/records/${kind}?q=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}&page=${page}`, revision);
  const states = kind === 'usage' ? ['reserved', 'unknown', 'issued', 'finished'] : kind === 'video' ? ['submitting', 'unknown', 'pending', 'processing', 'completed', 'failed'] : ['creating', 'pending', 'paid', 'failed', 'expired'];
  return <section className={s.panel}><h2>{kind === 'orders' ? say('全部沙盒订单', 'All sandbox orders') : kind === 'video' ? say('全部视频任务', 'All video tasks') : say('实时申请记录', 'Live generation requests')}</h2><p className={s.muted}>{say('仅查询业务元数据；不加载用户媒体，不替用户生成，不修改任务结果或支付金额。待核查记录保留原风险占用。', 'Business metadata only. No user media is loaded, no generation is triggered, and outcomes and payment amounts stay intact. Unknown outcomes retain their risk reservations.')}</p><Search say={say} submit={value => { setQuery(value); setPage(1); }}><label className={s.field}>{say('状态', 'Status')}<select value={state} onChange={event => { setState(event.target.value); setPage(1); }}><option value="">{say('全部', 'All')}</option>{states.map(value => <option key={value} value={value}>{stateName(value, say)}</option>)}</select></label></Search><LoadState loading={loading} error={error} say={say}>{data && <><div className={s.tableWrap}><table className={s.table}><thead><tr>{[say('账号 / 编号', 'Account / ID'), say('类型', 'Type'), say('状态', 'Status'), kind === 'orders' ? say('金额 CNY', 'Amount CNY') : say('时长', 'Duration'), say('创建时间', 'Created')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td>{row.username}<code>{row.id}</code></td><td>{sceneName(row.scene, say)}{row.title && <small>{row.title}</small>}</td><td><span className={s.badge}>{stateName(row.state, say)}</span></td><td>{kind === 'orders' ? `¥${((row.amount ?? 0) / 100).toFixed(2)}` : `${row.seconds ?? '—'}s`}</td><td>{new Date(row.createdAt).toLocaleString(intlLocale)}</td></tr>)}</tbody></table></div>{!data.items.length && <p className={s.empty}>{say('暂无匹配记录', 'No matching records')}</p>}<Pager {...data} setPage={setPage} say={say} /></>}</LoadState></section>;
}

function SettingsPanel({ revision, say, prepare }: { revision: number; say: Say; prepare: (value: Pending) => void }) {
  const { data, loading, error } = useData<AdminSettings>('/api/admin/settings', revision);
  return <LoadState loading={loading} error={error} say={say}>{data && <div className={s.stack} key={`${data.services.version}-${data.announcement.version}`}>
    <section className={s.panel}><h2>{say('暂停新生成', 'Pause new generation')}</h2><div className={s.notice}>{say('这是现有服务配置之上的暂停开关。取消暂停仅恢复原配置，不启用原本关闭的功能，不改变预算或取消在途任务。', 'These pause controls sit above existing configuration. Resuming only restores that configuration; it does not enable disabled features, alter budgets, or cancel in-flight tasks.')}</div><form className={s.stack} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const paused = { studio: form.has('studio'), video: form.has('video'), prompt: form.has('prompt') }; prepare({ path: '/api/admin/settings/services', body: { version: data.services.version, paused, reason: String(form.get('reason')).trim() }, summary: Object.entries(paused).map(([key, value]) => `${sceneName(key, say)}: ${value ? say('暂停新生成', 'Pause new requests') : say('按原配置运行', 'Use existing configuration')}`).join('\n') }); }}><div className={s.toolbar}>{(['studio', 'video', 'prompt'] as const).map(scene => <label className={s.check} key={scene}><input type="checkbox" name={scene} defaultChecked={data.services[scene]} />{sceneName(scene, say)}</label>)}</div><Reason say={say} /><div><button className={s.primary}>{say('核对服务修改', 'Review service changes')}</button></div></form></section>
    <section className={s.panel}><h2>{say('站点公告', 'Site announcement')}</h2><p className={s.muted}>{say('用于维护或内测通知，在全站左下角展示，可由用户关闭。仅显示纯文本；未发布的内容不会公开。', 'Maintenance and test notices appear in the lower-left corner across the site and can be dismissed. Plain text only. Unpublished content stays private.')}</p><form className={s.stack} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const enabled = form.has('enabled'); const zh = String(form.get('zh')).trim(); const en = String(form.get('en')).trim(); prepare({ path: '/api/admin/settings/announcement', body: { version: data.announcement.version, enabled, zh, en, reason: String(form.get('reason')).trim() }, summary: `${enabled ? say('发布全站公告', 'Publish site announcement') : say('关闭全站公告', 'Disable site announcement')}\n${zh}\n${en}` }); }}><label className={s.check}><input name="enabled" type="checkbox" defaultChecked={data.announcement.enabled} />{say('展示公告', 'Show announcement')}</label><div className={s.grid}><label className={s.field}>{say('中文正文', 'Chinese text')}<textarea name="zh" maxLength={240} defaultValue={data.announcement.zh} /></label><label className={s.field}>{say('英文正文', 'English text')}<textarea name="en" maxLength={400} defaultValue={data.announcement.en} /></label></div><Reason say={say} /><div><button className={s.primary}>{say('核对公告修改', 'Review announcement changes')}</button></div></form></section>
    <section className={s.panel}><h2>{say('页面与商品内容', 'Pages & products')}</h2><p className={s.muted}>{say('当前体量下，首页、帮助、协议及套餐价格随代码版本维护，避免网站文案、支付金额与权益规则各有一套。后台不提供任意代码、HTML、SQL 或密钥编辑器；后续频繁运营的内容再逐项接入。', 'At this project size, home, help, terms, and package prices stay versioned with code so copy, checkout amounts, and entitlement rules remain consistent. The console does not provide arbitrary code, HTML, SQL, or secret editors. Frequently operated content can be added individually as needed.')}</p><div className={s.toolbar}><Link className={s.button} href="/help">{say('帮助中心', 'Help')}</Link><Link className={s.button} href="/terms">{say('用户协议', 'Terms')}</Link><Link className={s.button} href="/pricing">{say('价格方案', 'Pricing')}</Link></div></section>
  </div>}</LoadState>;
}

function AuditPanel({ revision, say }: { revision: number; say: Say }) {
  const { intlLocale } = useI18n();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useData<AuditPage>(`/api/admin/audit?page=${page}`, revision);
  return <section className={s.panel}><h2>{say('管理操作日志', 'Administrative audit log')}</h2><p className={s.muted}>{say('记录操作者、对象、原因与修改前后值。日志不可在网页删除或改写。', 'Records the actor, target, reason, and before/after values. Logs cannot be deleted or rewritten from this console.')}</p><LoadState loading={loading} error={error} say={say}>{data && <><div className={s.tableWrap}><table className={s.table}><thead><tr>{[say('操作 / 时间', 'Action / time'), say('操作者', 'Actor'), say('对象', 'Target'), say('原因与变化', 'Reason & changes')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td>{row.action}<small>{new Date(row.createdAt).toLocaleString(intlLocale)}</small></td><td>{row.actor}</td><td><code>{row.target}</code></td><td>{row.reason}<details><summary>{say('查看变化', 'View changes')}</summary><pre>{row.changes}</pre></details></td></tr>)}</tbody></table></div>{!data.items.length && <p className={s.empty}>{say('暂无操作', 'No actions yet')}</p>}<Pager {...data} setPage={setPage} say={say} /></>}</LoadState></section>;
}

function Confirm({ pending, busy, error, say, close, save }: { pending: Pending; busy: boolean; error: string; say: Say; close: () => void; save: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(close); closing.current = close;
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={s.dialog} aria-labelledby="admin-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) closing.current(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}><h2 id="admin-confirm-title">{say('确认这次管理操作', 'Confirm this administrative action')}</h2><p>{pending.summary}</p><p className={s.muted}>{say('保存后会立即生效，并记录操作原因和修改内容。', 'Changes take effect immediately and are recorded with the reason in the audit log.')}</p>{error && <div className={s.error} role="alert">{error}</div>}<footer><button autoFocus className={s.button} disabled={busy} onClick={close}>{say('取消', 'Cancel')}</button><button className={s.primary} disabled={busy} onClick={save}>{busy ? say('正在保存…', 'Saving…') : say('确认保存', 'Confirm changes')}</button></footer></dialog>;
}
