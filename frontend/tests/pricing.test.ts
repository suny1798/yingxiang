import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICING, quote } from '../src/lib/legacy-pricing';
import { money, CREATION_PLANS, CREATION_SCENES, creditsFor, estimatedUses } from '../src/lib/pricing';
import { DURATION_OPTIONS, STUDIO_POLICY } from '../src/lib/studio/policy';
import { checkoutDestination, paymentProduct } from '../src/lib/payments';

test('购买跳转仅接受Stripe收银台，拒绝仿冒域名、脚本及含凭据链接', () => {
  assert.equal(checkoutDestination('https://checkout.stripe.com/c/pay/cs_test_example'), 'https://checkout.stripe.com/c/pay/cs_test_example');
  assert.equal(checkoutDestination(undefined), '/account/orders');
  for (const url of ['https://checkout.stripe.com.evil.example/pay', 'https://evil.example/?next=https://checkout.stripe.com', 'http://checkout.stripe.com/pay', 'javascript:alert(1)', 'https://name:password@checkout.stripe.com/pay', {}, 42]) {
    assert.throws(() => checkoutDestination(url), /支付链接无法验证/);
  }
});

test('所有拟定体验包使用整数分，单次价与组合折扣一致且无负节省', () => {
  for (const plan of PRICING) for (const count of [1, 5, 10] as const) {
    const value = quote(plan.seconds, count);
    assert.ok(Number.isSafeInteger(value.totalFen) && value.totalFen > 0);
    assert.equal(value.savedFen + value.totalFen, plan.prices[1] * count);
    assert.equal(value.totalSeconds, plan.seconds * count);
    assert.ok(value.savedFen >= 0);
    if (count === 1) assert.equal(value.savedFen, 0);
  }
  assert.deepEqual(quote(30, 5), { totalFen: 5690, unitFen: 1138, savedFen: 760, totalSeconds: 150 });
});

test('三档积分方案仅首档排除实时编辑，价格额度递增且大包单价更低', () => {
  assert.equal(CREATION_PLANS.length, 3);
  assert.deepEqual(CREATION_PLANS.map((plan) => plan.priceFen), [3900, 12900, 32900]);
  assert.deepEqual(CREATION_PLANS.map((plan) => plan.credits), [120, 450, 1200]);
  assert.deepEqual([...CREATION_PLANS[0].scenes], ['tryon', 'video']);
  for (const plan of CREATION_PLANS.slice(1)) assert.deepEqual([...plan.scenes], ['tryon', 'video', 'edit']);
  for (let i = 1; i < CREATION_PLANS.length; i++) {
    const before = CREATION_PLANS[i - 1], after = CREATION_PLANS[i];
    assert.ok(after.priceFen > before.priceFen && after.credits > before.credits);
    assert.ok(after.priceFen / after.credits < before.priceFen / before.credits);
  }
  assert.ok(CREATION_PLANS.every((plan) => Number.isSafeInteger(plan.priceFen) && plan.validityDays === null));
});

test('共享积分按功能倍数估算，不支持的实时编辑返回未包含，次数向下取整', () => {
  assert.equal(creditsFor('tryon', 15), 15);
  assert.equal(creditsFor('video', 7.74), 16);
  assert.equal(creditsFor('video', 15), 30);
  assert.equal(creditsFor('edit', 15), 15);
  assert.deepEqual(CREATION_PLANS.map((plan) => estimatedUses(plan.id, 'tryon', 15)), [8, 30, 80]);
  assert.deepEqual(CREATION_PLANS.map((plan) => estimatedUses(plan.id, 'video', 15)), [4, 15, 40]);
  assert.deepEqual(CREATION_PLANS.map((plan) => estimatedUses(plan.id, 'edit', 15)), [null, 30, 80]);
  assert.equal(estimatedUses('creator', 'tryon', 60), 7);
  for (const key of Object.keys(CREATION_SCENES) as Array<keyof typeof CREATION_SCENES>) {
    assert.throws(() => creditsFor(key, 0));
    assert.throws(() => creditsFor(key, NaN));
    assert.throws(() => creditsFor(key, Infinity));
    assert.throws(() => creditsFor(key, CREATION_SCENES[key].maxSeconds + 1));
  }
  assert.throws(() => creditsFor('__proto__' as never, 15));
  assert.throws(() => estimatedUses('invalid' as never, 'tryon', 15));
});

test('新积分SKU与旧沙盒商品明确区分，历史SKU仍保留原金额与次数', () => {
  for (const plan of CREATION_PLANS) {
    assert.throws(() => paymentProduct(plan.id), /INVALID_SKU/);
    assert.deepEqual(paymentProduct(`credits-v1-${plan.id}`), { sku: `credits-v1-${plan.id}`, planId: plan.id, credits: plan.credits, amount: plan.priceFen, currency: 'cny' });
  }
  assert.deepEqual(paymentProduct('tryon-v1-30-5'), { sku: 'tryon-v1-30-5', seconds: 30, count: 5, amount: 5690, currency: 'cny' });
});
test('未发布时长与任意次数不能拼出展示报价，货币格式保留两位', () => {
  assert.throws(() => quote(31 as never, 5));
  assert.throws(() => quote(120 as never, 5));
  assert.deepEqual(PRICING.map((item) => item.seconds), DURATION_OPTIONS);
  assert.throws(() => quote(15, 2 as never));
  assert.equal(money(690), '6.90'); assert.equal(money(10900), '109.00');
});
test('更长时长价格递增、批量单次价递减，拟定价目不会改变真实免费时限', () => {
  for (let i = 1; i < PRICING.length; i++) for (const count of [1, 5, 10] as const) assert.ok(PRICING[i].prices[count] > PRICING[i - 1].prices[count]);
  for (const plan of PRICING) {
    assert.ok(quote(plan.seconds, 10).unitFen <= quote(plan.seconds, 5).unitFen);
    assert.ok(quote(plan.seconds, 5).unitFen < quote(plan.seconds, 1).unitFen);
  }
  assert.equal(STUDIO_POLICY.clientWindowSec, 15); assert.equal(STUDIO_POLICY.connectionCapSec, 15);
});
