import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { accounts, type AccountStore } from './account-store';
import { localOrigin, readBoundedJson, StudioError } from './studio-gate';

export const STRIPE_API_VERSION = '2026-09-30.endive' as const;
export function paymentEnabled() {
  return process.env.YINGXIANG_PAYMENTS_TEST_ENABLED === 'true' && /^(rk|sk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '') && /^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET ?? '') && /^acct_/.test(process.env.STRIPE_EXPECTED_ACCOUNT_ID ?? '');
}
export function stripeClient() {
  if (!paymentEnabled()) throw new StudioError('PAYMENTS_DISABLED', '沙盒支付尚未配置，正式购买暂未开放。', 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 15000 });
}
export async function checkout(request: Request, client = stripeClient(), store: AccountStore = accounts) {
  const origin = localOrigin(request, true);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new StudioError('INVALID_REQUEST', '请使用JSON请求。', 415);
  const body = await readBoundedJson(request.body);
  if (Object.keys(body).sort().join(',') !== 'requestId,sku') throw new StudioError('INVALID_REQUEST', '支付参数无效。');
  const order = await store.reservePayment(request, body.sku, body.requestId);
  const merchant = await client.accounts.retrieve(null);
  if (merchant.id !== process.env.STRIPE_EXPECTED_ACCOUNT_ID) throw new StudioError('WRONG_ACCOUNT', '支付密钥不属于配置的映想沙盒。', 503);
  if (order.state === 'paid') return { orderId: order.id, paid: true };
  if (order.sessionId) {
    const session = await client.checkout.sessions.retrieve(order.sessionId);
    await store.applyPayment(session);
    if (session.status === 'open' && session.url && new URL(session.url).origin === 'https://checkout.stripe.com') return { orderId: order.id, url: session.url };
    return { orderId: order.id, paid: session.payment_status === 'paid' };
  }
  // Stripe 的幂等记录至少保留24小时；未知请求超过23小时后禁止重新创建，人工对账。
  if (Date.now() - Date.parse(order.createdAt) > 23 * 60 * 60_000) throw new StudioError('ORDER_REVIEW', '此订单需要人工核查，请勿重新付款。', 409);
  const session = await client.checkout.sessions.create({
    mode: 'payment', client_reference_id: order.id,
    metadata: { orderId: order.id, userId: order.userId, sku: order.sku },
    line_items: [{ quantity: 1, price_data: { currency: order.currency, unit_amount: order.amount, product_data: { name: `映想实时换装 · ${order.seconds}秒 × ${order.count}次（沙盒）` } } }],
    success_url: `${origin}/account?payment=returned`, cancel_url: `${origin}/account?payment=cancelled`,
    adaptive_pricing: { enabled: false }, integration_identifier: `yingxiang_test_${Array.from(createHash('sha256').update(order.id).digest().subarray(0, 8), (v) => String.fromCharCode(97 + v % 26)).join('')}`,
  }, { idempotencyKey: `yingxiang-test-${order.id}` });
  await store.applyPayment(session);
  if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new StudioError('CHECKOUT_UNAVAILABLE', '支付链接尚未准备好，请到订单中核查。', 503);
  return { orderId: order.id, url: session.url };
}
export async function reconcile(request: Request, client = stripeClient(), store: AccountStore = accounts) {
  const body = await readBoundedJson(request.body);
  if (Object.keys(body).join(',') !== 'orderId' || typeof body.orderId !== 'string') throw new StudioError('INVALID_REQUEST', '订单编号无效。');
  const order = await store.ownPayment(request, body.orderId);
  if (!order.sessionId) {
    const result = await checkout(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ sku: order.sku, requestId: order.requestId }) }), client, store);
    return { ...await store.paymentOrders(request), url: 'url' in result ? result.url : undefined };
  }
  const session = await client.checkout.sessions.retrieve(order.sessionId);
  await store.applyPayment(session);
  return { ...await store.paymentOrders(request), url: session.status === 'open' ? session.url : undefined };
}
export async function webhook(request: Request, client = stripeClient(), store: AccountStore = accounts) {
  const signature = request.headers.get('stripe-signature');
  if (!signature || !request.body) throw new StudioError('INVALID_SIGNATURE', '付款通知验签失败。');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 262144) { await reader.cancel(); throw new StudioError('BODY_TOO_LARGE', '通知内容过大。', 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  let event: Stripe.Event;
  try { event = client.webhooks.constructEvent(Buffer.concat(chunks), signature, process.env.STRIPE_WEBHOOK_SECRET!); }
  catch { throw new StudioError('INVALID_SIGNATURE', '付款通知验签失败。'); }
  if (event.livemode || event.account) throw new StudioError('WRONG_ACCOUNT_MODE', '只接受当前沙盒的直接付款通知。');
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    await store.applyPayment(await client.checkout.sessions.retrieve(session.id), event.id, event.type === 'checkout.session.async_payment_failed');
  }
  return { received: true };
}
