'use client';
import { useI18n } from '@/components/preferences';
import { useNotice } from '@/hooks/use-notice';

import { useEffect, useRef, useState } from 'react';
import { checkoutDestination, PAYMENT_STATES, type OrderView } from '@/lib/payments';
import { CREATION_PLANS, CREATION_SCENES, type CreationScene, money } from '@/lib/pricing';
import { useSiteAccount } from './site-shell';
import s from './site.module.css';

async function api(url: string, body?: object) {
  const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? '支付服务暂不可用。');
  return data;
}
/** 卡片和确认弹窗共用一次支付状态，确认前不创建订单。 */
export function useSandboxCheckout() {
  const { account, openLogin, refresh } = useSiteAccount();
  const [enabled, setEnabled] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<{ sku: string; userId: string; requestId: string } | null>(null);
  const inFlight = useRef(false), currentUser = useRef(account?.user?.id), mounted = useRef(true);
  currentUser.current = account?.user?.id;
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void api('/api/payments/status').then(v => { if (!disposed) setEnabled(v.testEnabled === true); }).catch(() => { if (!disposed) setError('支付服务暂不可用。'); }).finally(() => { if (!disposed) setReady(true); });
    return () => { disposed = true; mounted.current = false; };
  }, []);
  const buy = async (sku: string) => {
    if (inFlight.current || !enabled) return;
    if (!account?.user) { openLogin(); return; }
    const userId = account.user.id;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      const verified = await refresh();
      if (!mounted.current) return;
      if (!verified?.user) { openLogin(); return; }
      if (verified.user.id !== userId) throw new Error('登录状态已变化，请重新确认订单。');
      // 网络失败保留同一操作，避免重复创建；账号或商品变化后另建操作。
      if (!operation.current || operation.current.sku !== sku || operation.current.userId !== account.user.id) operation.current = { sku, userId: account.user.id, requestId: crypto.randomUUID() };
      const { requestId } = operation.current;
      const result = await api('/api/payments/checkout', { sku, requestId });
      if (!mounted.current) return;
      if (currentUser.current !== userId) throw new Error('登录状态已变化，请重新确认订单。');
      window.location.assign(checkoutDestination(result.url));
    } catch (e) { setError(e instanceof Error ? e.message : '支付准备未完成，请到订单中核查。'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  useNotice(error);
  return { enabled, ready, busy, error, buy, clearError: () => setError('') };
}
export function SandboxOrders() {
  const { t, intlLocale } = useI18n();
  const { account } = useSiteAccount();
  const [orders, setOrders] = useState<OrderView[]>([]), [credits, setCredits] = useState<Record<string, number>>({});
  const [packs, setPacks] = useState<Array<{ orderId: string; planId: string; credits: number; scenes: CreationScene[] }>>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const userId = account?.user?.id;
  useEffect(() => {
    let cancelled = false; setOrders([]); setCredits({}); setPacks([]); setError('');
    if (userId) {
      const query = new URLSearchParams(window.location.search);
      const orderId = query.get('payment') === 'returned' ? query.get('orderId') : null;
      void api(orderId ? '/api/payments/reconcile' : '/api/payments/orders', orderId ? { orderId } : undefined).then((v) => { if (!cancelled) { setOrders(v.orders); setCredits(v.sandboxCredits); setPacks(v.sandboxCreditPacks ?? []); } }).catch((e) => { if (!cancelled) setError(e.message); });
    }
    return () => { cancelled = true; };
  }, [userId]);
  const refresh = async (orderId?: string, resume = false) => {
    setBusy(true); setError('');
    try { const value = await api(orderId ? '/api/payments/reconcile' : '/api/payments/orders', orderId ? { orderId } : undefined); setOrders(value.orders); setCredits(value.sandboxCredits); setPacks(value.sandboxCreditPacks ?? []); if (resume && value.url) { const url = new URL(value.url); if (url.origin !== 'https://checkout.stripe.com') throw new Error('支付链接无法验证。'); window.location.assign(url.href); } }
    catch (e) { setError(e instanceof Error ? e.message : '订单读取失败。'); } finally { setBusy(false); }
  };
  useNotice(error);
  return <><p>{t("正式购买暂未开放。以下仅为沙盒订单；返回此页不会自动认定付款。")}</p><button type="button" className={s.outline} disabled={busy} onClick={() => void refresh()}>{t("刷新订单")}</button>{Object.keys(credits).length > 0 && <p>{t("测试权益（不可用于真实模型）：")}{Object.entries(credits).map(([sec, n]) => t(`${sec}秒 × ${n}次`)).join(' / ')}</p>}{packs.length > 0 && <div><p>{t("测试积分：")}{packs.reduce((sum, p) => sum + p.credits, 0)} {t(" · 长期有效 · 不可用于真实模型")}</p>{packs.map((p) => <p key={p.orderId}>{t(CREATION_PLANS.find((v) => v.id === p.planId)?.name ?? p.planId)} · {p.credits} {t(" 积分 · ")}{p.scenes.map((v) => t(CREATION_SCENES[v].label)).join(" / ")}</p>)}</div>}{error && <p role="alert">{t(error)}</p>}{orders.length ? <div className={s.historyTable}><table><thead><tr><th>{t("沙盒方案")}</th><th>{t("金额")}</th><th>{t("状态")}</th><th>{t("核查")}</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}><td>{t(o.planId ? `${CREATION_PLANS.find((p) => p.id === o.planId)?.name ?? o.planId} · ${o.credits}积分` : `${o.seconds}秒 × ${o.count}次`)}<br /><small>{o.id}</small></td><td>¥{t(money(o.amount))}</td><td>{t(PAYMENT_STATES[o.state])}</td><td><button type="button" disabled={busy} onClick={() => void refresh(o.id)}>{t("查单")}</button>{(o.state === 'pending' || o.state === 'creating') && <button type="button" disabled={busy} onClick={() => void refresh(o.id, true)}>{t("继续测试付款")}</button>}</td></tr>)}</tbody></table></div> : <p>{t("暂无沙盒订单。")}</p>}</>;
}
