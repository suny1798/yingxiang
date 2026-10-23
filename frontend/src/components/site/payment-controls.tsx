'use client';

import { useEffect, useRef, useState } from 'react';
import { PAYMENT_STATES, type OrderView } from '@/lib/payments';
import { money } from '@/lib/pricing';
import { useSiteAccount } from './site-shell';
import s from './site.module.css';

async function api(url: string, body?: object) {
  const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? '支付服务暂不可用。');
  return data;
}
export function SandboxPurchase({ sku }: { sku: string }) {
  const { account, openLogin } = useSiteAccount();
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<{ sku: string; userId: string; requestId: string } | null>(null);
  useEffect(() => { void api('/api/payments/status').then((v) => setEnabled(v.testEnabled)).catch(() => {}); }, []);
  const buy = async () => {
    if (!account?.user) { openLogin(); return; }
    setBusy(true); setError('');
    try {
      // 网络失败保留同一操作，避免重复创建；账号或商品变化后另建操作。
      if (!operation.current || operation.current.sku !== sku || operation.current.userId !== account.user.id) operation.current = { sku, userId: account.user.id, requestId: crypto.randomUUID() };
      const { requestId } = operation.current;
      const result = await api('/api/payments/checkout', { sku, requestId });
      if (result.url) { const url = new URL(result.url); if (url.origin !== 'https://checkout.stripe.com') throw new Error('支付链接无法验证。'); window.location.assign(url.href); }
      else window.location.assign('/account');
    } catch (e) { setError(e instanceof Error ? e.message : '支付准备未完成，请到订单中核查。'); }
    finally { setBusy(false); }
  };
  return <><button type="button" disabled={!enabled || busy} className={enabled ? s.primary : s.disabledPurchase} onClick={() => void buy()}>{busy ? '正在准备…' : enabled ? '沙盒测试付款' : '购买暂未开放'}</button>{enabled && <p>仅测试付款，测试权益不能消耗真实模型。</p>}{error && <p role="alert">{error}</p>}</>;
}
export function SandboxOrders() {
  const { account } = useSiteAccount();
  const [orders, setOrders] = useState<OrderView[]>([]), [credits, setCredits] = useState<Record<string, number>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const userId = account?.user?.id;
  useEffect(() => {
    let cancelled = false; setOrders([]); setCredits({}); setError('');
    if (userId) void api('/api/payments/orders').then((v) => { if (!cancelled) { setOrders(v.orders); setCredits(v.sandboxCredits); } }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId]);
  const refresh = async (orderId?: string, resume = false) => {
    setBusy(true); setError('');
    try { const value = await api(orderId ? '/api/payments/reconcile' : '/api/payments/orders', orderId ? { orderId } : undefined); setOrders(value.orders); setCredits(value.sandboxCredits); if (resume && value.url) { const url = new URL(value.url); if (url.origin !== 'https://checkout.stripe.com') throw new Error('支付链接无法验证。'); window.location.assign(url.href); } }
    catch (e) { setError(e instanceof Error ? e.message : '订单读取失败。'); } finally { setBusy(false); }
  };
  return <><p>正式购买暂未开放。以下仅为沙盒订单；返回此页不会自动认定付款。</p><button type="button" className={s.outline} disabled={busy} onClick={() => void refresh()}>刷新订单</button>{Object.keys(credits).length > 0 && <p>测试权益（不可用于真实模型）：{Object.entries(credits).map(([sec, n]) => `${sec}秒 × ${n}次`).join(' / ')}</p>}{error && <p role="alert">{error}</p>}{orders.length ? <div className={s.historyTable}><table><thead><tr><th>沙盒方案</th><th>金额</th><th>状态</th><th>核查</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}><td>{o.seconds}秒 × {o.count}次<br /><small>{o.id}</small></td><td>¥{money(o.amount)}</td><td>{PAYMENT_STATES[o.state]}</td><td><button type="button" disabled={busy} onClick={() => void refresh(o.id)}>查单</button>{(o.state === 'pending' || o.state === 'creating') && <button type="button" disabled={busy} onClick={() => void refresh(o.id, true)}>继续测试付款</button>}</td></tr>)}</tbody></table></div> : <p>暂无沙盒订单。</p>}</>;
}
