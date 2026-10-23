import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { AccountStore } from '../src/lib/server/account-store';
import { paymentProduct } from '../src/lib/payments';
import { checkout, reconcile, webhook, paymentEnabled, stripeClient } from '../src/lib/server/stripe-payments';

const origin = 'http://127.0.0.1:8787';
const req = (cookie = '', body?: object) => new Request(`${origin}/api/payments/checkout`, { method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:8787', origin, cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxiang-payments-'));
  const store = new AccountStore(dir);
  const signup = await store.authenticate(req('', { username: 'payment_user', password: 'test-password-only' }), true);
  const cookie = signup.cookie.split(';')[0];
  const order = await store.reservePayment(req(cookie), 'tryon-v1-30-5', randomUUID());
  const session = { id: 'cs_test_fixture', object: 'checkout.session', mode: 'payment', livemode: false, client_reference_id: order.id, metadata: { orderId: order.id, userId: order.userId, sku: order.sku }, currency: 'cny', amount_total: order.amount, payment_status: 'unpaid', status: 'open', url: 'https://checkout.stripe.com/c/pay/test_fixture', expires_at: Math.floor(Date.now() / 1000) + 1800 } as unknown as Stripe.Checkout.Session;
  return { dir, store, cookie, order, session };
}
test('九个固定商品拒绝额外金额和伪造SKU', async () => {
  for (const sec of [15, 30, 60]) for (const count of [1, 5, 10]) assert.equal(paymentProduct(`tryon-v1-${sec}-${count}`).count, count);
  assert.throws(() => paymentProduct('tryon-v1-120-100'));
  const f = await fixture();
  await assert.rejects(checkout(req(f.cookie, { sku: f.order.sku, requestId: randomUUID(), amount: 1 }), { accounts: { retrieve: async () => ({ id: process.env.STRIPE_EXPECTED_ACCOUNT_ID }) } } as unknown as Stripe, f.store), { code: 'INVALID_REQUEST' });
});
test('支付归属、金额、币种、模式及Session错配均不发权益', async () => {
  const f = await fixture();
  for (const change of [{ amount_total: 1 }, { currency: 'usd' }, { livemode: true }, { mode: 'subscription' }, { client_reference_id: 'other' }, { metadata: { ...f.session.metadata, userId: 'other' } }]) {
    await assert.rejects(f.store.applyPayment({ ...f.session, status: 'complete', payment_status: 'paid', ...change } as Stripe.Checkout.Session), { code: 'PAYMENT_MISMATCH' });
  }
  assert.deepEqual((await f.store.paymentOrders(req(f.cookie))).sandboxCredits, {});
  await f.store.applyPayment(f.session);
  await assert.rejects(f.store.applyPayment({ ...f.session, id: 'cs_other' }), { code: 'PAYMENT_MISMATCH' });
});
test('并发、重复事件、不同事件及重启仅发一次；测试权益不增加真实时长次数', async () => {
  const f = await fixture(), paid = { ...f.session, status: 'complete', payment_status: 'paid' } as Stripe.Checkout.Session;
  const store2 = new AccountStore(f.dir);
  await Promise.all([f.store.applyPayment(paid, 'evt_a'), store2.applyPayment(paid, 'evt_a'), f.store.applyPayment(paid, 'evt_b')]);
  const result = await new AccountStore(f.dir).paymentOrders(req(f.cookie));
  assert.equal(result.sandboxCredits[30], 5); assert.equal(result.orders[0].state, 'paid');
  const account = await f.store.me(req(f.cookie));
  assert.equal(account.trialRemaining, 1); assert.equal(account.durations.find((d) => d.seconds === 30)?.remaining, 0);
  await assert.rejects(f.store.requireTrial(req(f.cookie), 30), { code: 'DURATION_UNAVAILABLE' });
  await f.store.applyPayment({ ...f.session, status: 'expired' }, 'evt_late');
  assert.equal((await f.store.paymentOrders(req(f.cookie))).orders[0].state, 'paid');
});
test('未付款完成、异步失败、过期不发放；之后确实付款可恢复一次', async () => {
  const f = await fixture();
  await f.store.applyPayment({ ...f.session, status: 'complete' }, 'evt_unpaid');
  assert.deepEqual((await f.store.paymentOrders(req(f.cookie))).sandboxCredits, {});
  await f.store.applyPayment(f.session, 'evt_failed', true);
  assert.equal((await f.store.paymentOrders(req(f.cookie))).orders[0].state, 'failed');
  await f.store.applyPayment({ ...f.session, status: 'expired' }, 'evt_expired');
  assert.equal((await f.store.paymentOrders(req(f.cookie))).orders[0].state, 'expired');
  await f.store.applyPayment({ ...f.session, status: 'complete', payment_status: 'paid' }, 'evt_paid');
  assert.equal((await f.store.paymentOrders(req(f.cookie))).sandboxCredits[30], 5);
});
test('只能查看本人订单，同源校验及未知操作复用，旧数据/手工配额保留', async () => {
  const f = await fixture();
  const another = await f.store.authenticate(req('', { username: 'other_user', password: 'test-password-only' }), true);
  const otherCookie = another.cookie.split(';')[0];
  assert.equal((await f.store.paymentOrders(req(otherCookie))).orders.length, 0);
  await assert.rejects(f.store.ownPayment(req(otherCookie), f.order.id), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(f.store.paymentOrders(req()), { code: 'LOGIN_REQUIRED' });
  const malicious = req(f.cookie); malicious.headers.set('origin', 'https://evil.example');
  await assert.rejects(f.store.reservePayment(malicious, f.order.sku, randomUUID()), { code: 'ORIGIN_REJECTED' });
  assert.equal((await f.store.reservePayment(req(f.cookie), f.order.sku, randomUUID())).id, f.order.id);
  await assert.rejects(f.store.reservePayment(req(f.cookie), 'tryon-v1-15-1', f.order.requestId), { code: 'PAYMENT_CONFLICT' });
  const file = path.join(f.dir, 'store.json'), saved = JSON.parse(await readFile(file, 'utf8'));
  saved.quotas = { [f.order.userId]: 9 }; saved.durationQuotas = { [f.order.userId]: { 60: 7 } }; saved.extraHistoricalRecord = 'keep';
  await writeFile(file, JSON.stringify(saved));
  await f.store.applyPayment(f.session);
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after.quotas, saved.quotas); assert.deepEqual(after.durationQuotas, saved.durationQuotas); assert.equal(after.extraHistoricalRecord, 'keep');
});
test('Checkout固定服务端参数，网络未知重试保持幂等key和全部参数，查单可恢复', async () => {
  const f = await fixture(), calls: unknown[][] = []; let count = 0;
  const client = { accounts: { retrieve: async () => ({ id: process.env.STRIPE_EXPECTED_ACCOUNT_ID }) }, checkout: { sessions: {
    create: async (...args: unknown[]) => { calls.push(args); if (++count === 1) throw new Error('network unknown'); return f.session; },
    retrieve: async () => ({ ...f.session, status: 'complete', payment_status: 'paid' }),
  } } } as unknown as Stripe;
  const body = { sku: f.order.sku, requestId: f.order.requestId };
  await assert.rejects(checkout(req(f.cookie, body), client, f.store));
  const recovered = await reconcile(req(f.cookie, { orderId: f.order.id }), client, f.store);
  assert.equal(recovered.orders[0].state, 'pending'); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  const params = calls[0][0] as Stripe.Checkout.SessionCreateParams;
  assert.equal(params.mode, 'payment'); assert.equal(params.line_items?.[0].price_data?.unit_amount, f.order.amount);
  assert.equal(params.line_items?.[0].quantity, 1); assert.equal('payment_method_types' in params, false); assert.equal(params.adaptive_pricing?.enabled, false);
  const paid = await reconcile(req(f.cookie, { orderId: f.order.id }), client, f.store);
  assert.equal(paid.sandboxCredits[30], 5);
});
test('未知订单超过23小时不重新创建；密钥账户不符拒绝', async () => {
  const f = await fixture();
  const file = path.join(f.dir, 'store.json'), saved = JSON.parse(await readFile(file, 'utf8'));
  saved.paymentOrders[0].createdAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString(); await writeFile(file, JSON.stringify(saved));
  let called = false;
  const client = { accounts: { retrieve: async () => ({ id: process.env.STRIPE_EXPECTED_ACCOUNT_ID }) }, checkout: { sessions: { create: async () => { called = true; } } } } as unknown as Stripe;
  await assert.rejects(checkout(req(f.cookie, { sku: f.order.sku, requestId: f.order.requestId }), client, f.store), { code: 'ORDER_REVIEW' }); assert.equal(called, false);
  const wrong = { accounts: { retrieve: async () => ({ id: 'acct_wrong' }) } } as unknown as Stripe;
  await assert.rejects(checkout(req(f.cookie, { sku: f.order.sku, requestId: f.order.requestId }), wrong, f.store), { code: 'WRONG_ACCOUNT' });
});
test('真实SDK验签拒绝伪造/过期/篡改/live通知；已签名事件仍读取服务端状态', async () => {
  const f = await fixture(), secret = 'whsec_test_fixture_only';
  const before = process.env.STRIPE_WEBHOOK_SECRET; process.env.STRIPE_WEBHOOK_SECRET = secret;
  try {
    const client = new Stripe('sk_test_fixture_only');
    client.checkout.sessions.retrieve = (async () => ({ ...f.session, status: 'complete', payment_status: 'paid' })) as unknown as typeof client.checkout.sessions.retrieve;
    const event = { id: 'evt_signed', type: 'checkout.session.completed', livemode: false, data: { object: f.session } };
    const payload = JSON.stringify(event);
    const signature = client.webhooks.generateTestHeaderString({ payload, secret });
    const request = (body: string, sig = signature) => new Request(`${origin}/api/payments/webhook`, { method: 'POST', headers: { 'stripe-signature': sig }, body });
    await assert.rejects(webhook(request(payload, 'bad'), client, f.store), { code: 'INVALID_SIGNATURE' });
    await assert.rejects(webhook(request(payload + ' '), client, f.store), { code: 'INVALID_SIGNATURE' });
    const old = client.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 600 });
    await assert.rejects(webhook(request(payload, old), client, f.store), { code: 'INVALID_SIGNATURE' });
    const live = JSON.stringify({ ...event, livemode: true });
    await assert.rejects(webhook(request(live, client.webhooks.generateTestHeaderString({ payload: live, secret })), client, f.store), { code: 'WRONG_ACCOUNT_MODE' });
    await webhook(request(payload), client, f.store); await webhook(request(payload), client, f.store);
    assert.equal((await f.store.paymentOrders(req(f.cookie))).sandboxCredits[30], 5);
  } finally { if (before === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = before; }
});
test('默认关闭且拒绝live密钥', () => {
  const original = { ...process.env };
  try {
    process.env.YINGXIANG_PAYMENTS_TEST_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture'; process.env.STRIPE_EXPECTED_ACCOUNT_ID = 'acct_fixture';
    assert.equal(paymentEnabled(), false); assert.throws(stripeClient, { code: 'PAYMENTS_DISABLED' });
    process.env.STRIPE_SECRET_KEY = 'rk_test_fixture'; assert.equal(paymentEnabled(), true);
    process.env.YINGXIANG_PAYMENTS_TEST_ENABLED = 'false'; assert.equal(paymentEnabled(), false);
  } finally { for (const name of ['YINGXIANG_PAYMENTS_TEST_ENABLED', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_EXPECTED_ACCOUNT_ID']) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } }
});
