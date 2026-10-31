import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BILLING,TOPUP_PLANS,usageQuote,settleQuote} from '../src/lib/billing';
import {paymentProduct} from '../src/lib/payments';

test('前后台目录一致，三种功能每秒1积分并向上取整',()=>{
  assert.deepEqual(BILLING,JSON.parse(readFileSync(new URL('../../backend/src/main/resources/billing-catalog.json',import.meta.url),'utf8')));
  for(const scene of ['studio','video','prompt'] as const) assert.equal(usageQuote(scene,scene==='video'?10:15).credits,scene==='video'?10:15);
  assert.equal(usageQuote('studio',30).credits,30);
  assert.deepEqual(usageQuote('video',7.7),{billedSeconds:8,credits:8});
});
test('美元充值档位单价依次降低，最高优惠严格为0.045美元每积分',()=>{
  assert.equal(BILLING.currency,'usd');
  assert.deepEqual(TOPUP_PLANS.map(p=>[p.paidMinor,p.credits]),[[500,100],[1900,400],[4500,1000]]);
  assert.deepEqual(TOPUP_PLANS.map(p=>p.unitPriceMicroUsd),[50000,47500,45000]);
  assert.deepEqual(TOPUP_PLANS.map(p=>p.discountPercent),[0,5,10]);
  assert.ok(TOPUP_PLANS.every(p=>p.unitPriceMicroUsd>=BILLING.minimumPriceMicroUsdPerCredit));
  assert.deepEqual(paymentProduct('credits-v2-creator'),{sku:'credits-v2-creator',planId:'creator',credits:400,amount:1900,currency:'usd'});
});
test('预留15积分，实际7.7秒扣8返7；无出画全返，重复结算由后台幂等保障',()=>{
  assert.deepEqual(settleQuote(15,7.7),{billedSeconds:8,chargedCredits:8,returnedCredits:7});
  assert.deepEqual(settleQuote(30,0),{billedSeconds:0,chargedCredits:0,returnedCredits:30});
  assert.deepEqual(settleQuote(30,30),{billedSeconds:30,chargedCredits:30,returnedCredits:0});
  assert.throws(()=>settleQuote(15,16));
});
