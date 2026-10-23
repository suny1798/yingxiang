import test from 'node:test';
import assert from 'node:assert/strict';
import { money, PRICING, quote } from '../src/lib/pricing';
import { DURATION_OPTIONS, STUDIO_POLICY } from '../src/lib/studio/policy';

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
