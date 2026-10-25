'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { useNotice } from '@/hooks/use-notice';
import { useState } from 'react';
import { durationLabel } from '@/lib/studio/policy';
import { useSiteAccount, SiteShell } from './site-shell';
import s from './site.module.css';
import { SandboxOrders } from './payment-controls';

export type AccountSection = 'overview' | 'usage' | 'orders' | 'security';

const NAV: Array<{ key: AccountSection; href: string; label: string }> = [
  { key: 'overview', href: '/account', label: '权益概览' },
  { key: 'usage', href: '/account/usage', label: '使用记录' },
  { key: 'orders', href: '/account/orders', label: '我的订单' },
  { key: 'security', href: '/account/security', label: '账号信息' },
];

function AccountContent({ section }: { section: AccountSection }) {
  const { t, intlLocale } = useI18n();
  const { account, error, openLogin, logout, refresh } = useSiteAccount();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useNotice(actionError);
  const signout = async () => { setBusy(true); setActionError(null); try { await logout(); } catch { setActionError('退出未完成，请重试。'); } finally { setBusy(false); } };
  if (!account || error) return <main className={`${s.container} ${s.accountGate}`}><p className={s.eyebrow}>{t("映想 · 个人中心")}</p><h1>{t(error ? '账号暂时没有准备好。' : '正在打开你的空间…')}</h1>{error && <><p>{t(error)}</p><button type="button" className={s.outline} onClick={() => void refresh()}>{t("重新读取")}</button></>}</main>;
  if (!account.user) return <main className={`${s.container} ${s.accountGate}`}><span className={s.gateStar} aria-hidden="true">✳</span><p className={s.eyebrow}>{t("映想 · 个人中心")}</p><h1>{t("每一次想象，")}<br /><span>{t("都从你开始。")}</span></h1><p>{t("登录后查看免费权益、使用记录与账号信息。")}<br />{t("只是想先看看？创作空间随时为你开放。")}</p><div className={s.gateActions}><button type="button" className={s.primary} onClick={openLogin}>{t("登录我的账号 ")}<span aria-hidden="true">↗</span></button><Link href="/studio" prefetch={false} className={s.textLink}>{t("先去选图 →")}</Link></div></main>;
  const remaining = account.trialRemaining, trial = remaining > 0, review = account.trial === 'review';
  const longDurations = account.durations.filter((item) => item.seconds !== 15);
  const longRemaining = longDurations.reduce((sum, item) => sum + item.remaining, 0);
  return <main className={`${s.container} ${s.accountLayout}`}><aside className={s.accountSidebar}><p className={s.eyebrow}>{t("我的映想")}</p><h1>{t("个人中心")}</h1><nav aria-label={t("个人中心导航")}>{NAV.map((item) => {
    const active = item.key === section;
    return <Link key={item.key} href={item.href} prefetch={false} className={active ? s.accountNavActive : undefined} aria-current={active ? 'page' : undefined}>{t(item.label)}{active && <span aria-hidden="true">↗</span>}</Link>;
  })}</nav><p>{t("给灵感，")}<br />{t("一个开始。")}</p></aside><div className={s.accountMain}>
    {section === 'overview' && <>
      <section className={s.accountWelcome}><div><p className={s.eyebrow}>{t("欢迎回到创作空间")}</p><h2>{t("你好，")}{account.user.username}<span>。</span></h2><p>{t(trial ? account.history.length ? `还有 ${remaining} 次免费体验，继续探索画面。` : '第一份灵感已就位，今天想试哪件服装？' : review ? '上一次连接需要核查，请联系开发者确认。' : '感谢你的第一次尝试，更多体验方案正在准备。')}</p></div><span className={s.largeAvatar} aria-hidden="true">{account.user.username[0].toUpperCase()}</span></section>
      <section className={s.accountBenefits} aria-label={t("我的权益")}><div className={s.trialBenefit}><div className={s.quoteTop}><span>{t("新用户礼遇")}</span><span>{t(trial ? '待使用' : review ? '待核查' : '已使用')}</span></div><strong>{remaining}<span>{t("次免费体验")}</span></strong><p>{t("共 ")}{account.trialLimit} {t(" 次，每次最多15秒，生成画面开始播放后计时。")}</p>{trial ? <Link href="/studio" prefetch={false}>{t("去使用免费体验 ↗")}</Link> : <span className={s.benefitNote}>{t(review ? '不自动重试，请联系开发者核查。' : `免费权益共 ${account.trialLimit} 次。`)}</span>}</div><div className={s.paidBenefit}><div className={s.quoteTop}><span>{t("长时权益")}</span><span>{t(longRemaining ? '已发放' : '购买暂未开放')}</span></div><strong>{longRemaining}<span>{t("次可用体验")}</span></strong><p>{longDurations.map((item) => t(`${durationLabel(item.seconds)} · ${item.remaining}次`)).join(' / ')}</p>{longRemaining ? <Link href="/studio" prefetch={false}>{t("去使用对应时长 ↗")}</Link> : <Link href="/pricing">{t("查看拟定价格 ↗")}</Link>}</div></section>
    </>}
    {section === 'usage' && <section className={s.accountSection}><div className={s.cardHeading}><h2>{t("使用记录")}</h2><span>{t("最近20条 · 北京时间")}</span></div>{account.history.length ? <div className={s.historyTable}><table><thead><tr><th>{t("体验内容")}</th><th>{t("时间")}</th><th>{t("状态")}</th></tr></thead><tbody>{account.history.map((item) => <tr key={item.id}><td>{t("实时换装 ")}<small>{t(durationLabel(item.durationSec))}{t("体验")}</small></td><td><time dateTime={item.createdAt}>{t(new Intl.DateTimeFormat(intlLocale, { month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai' }).format(new Date(item.createdAt)))}</time></td><td><span className={s.statusPill}>{t(item.state === 'review' ? '待核查' : item.outcome === 'ended' ? '已结束' : item.outcome === 'error' ? '连接异常' : '已申请连接')}</span></td></tr>)}</tbody></table></div> : <div className={s.emptyState}><span aria-hidden="true">↗</span><h3>{t("第一条记录，等你开启。")}</h3><p>{t("选一件服装，开始第一次实时换装。这里只记录使用状态，不保存画面。")}</p><Link href="/studio" prefetch={false} className={s.textLink}>{t("进入创作空间 →")}</Link></div>}</section>}
    {section === 'orders' && <section className={s.accountSection}><div className={s.cardHeading}><h2>{t("我的订单")}</h2><Link href="/pricing">{t("查看价格 →")}</Link></div><SandboxOrders /></section>}
    {section === 'security' && <section className={s.accountSection}><div className={s.cardHeading}><h2>{t("账号信息")}</h2><span>{t("账号密码登录")}</span></div><dl className={s.accountDetails}><div><dt>{t("账号")}</dt><dd>{account.user.username}</dd></div><div><dt>{t("注册日期")}</dt><dd>{t(new Intl.DateTimeFormat(intlLocale, {timeZone:'Asia/Shanghai'}).format(new Date(account.user.createdAt)))}</dd></div><div><dt>{t("手机号验证")}</dt><dd>{t("暂未开放")}</dd></div><div><dt>{t("密码管理")}</dt><dd>{t("暂不支持找回，请妥善保存密码。")}</dd></div></dl><div className={s.accountSignout}><span>{t("不保存参考图与相机录像。")}</span><button type="button" disabled={busy} onClick={() => void signout()}>{t(busy ? '正在退出…' : '退出登录')}</button></div>{actionError && <p role="alert" className={s.inlineError}>{t(actionError)}</p>}</section>}
  </div></main>;
}

export function PersonalCenter({ section = 'overview' }: { section?: AccountSection }) {
  return <SiteShell active="account"><AccountContent section={section} /></SiteShell>;
}
