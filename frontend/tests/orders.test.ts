import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import type { PaymentOrderView } from '../src/lib/api-schema';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import { SandboxOrders,type OrdersPlatform } from '../src/vue/orders';
const scope=()=>new SessionScope(createAppQueryClient(),createPinia());
const order=(id:string,state:PaymentOrderView['state']='pending'):PaymentOrderView=>({id,sku:'credits-v1-creator',seconds:null,count:null,amount:12900,currency:'cny',createdAt:'2026-10-28T00:00:00.000Z',state,planId:'creator',credits:450});
const view=(orders:PaymentOrderView[]=[],extra:Record<string,unknown>={})=>({orders,sandboxCredits:{},sandboxCreditPacks:[],sandboxPointBalance:0,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function platform(returnOrder:string|null=null) {
  const calls:Array<{url:string;body?:object;signal:AbortSignal}>=[];
  const pending:Array<{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>=[];
  const navigations:string[]=[],notices:Array<{message:string;kind:string}>=[];
  const value:OrdersPlatform={
    request:<T,>(url:string,body:object|undefined,signal:AbortSignal)=>{calls.push({url,body,signal});return new Promise<T>((resolve,reject)=>{pending.push({resolve:resolve as (value:unknown)=>void,reject});});},
    paymentReturn:()=>returnOrder,
    navigate:url=>navigations.push(url),
    notify:(message,kind)=>notices.push({message,kind}),
  };
  return {value,calls,pending,navigations,notices,resolve:(result:unknown)=>pending.shift()!.resolve(result),reject:(error:unknown)=>pending.shift()!.reject(error)};
}

test('未登录不发私有请求；登录后读取本人订单、测试权益与积分包',async()=>{
  const s=scope(),p=platform(),orders=new SandboxOrders(s,p.value);
  await orders.load();
  assert.equal(p.calls.length,0);assert.equal(orders.getSnapshot().owner,null);
  await s.changeIdentity('user-1');
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,'/api/payments/orders');assert.equal(p.calls[0].body,undefined);
  p.resolve(view([order('order-1')],{sandboxCredits:{'30':2},sandboxCreditPacks:[{orderId:'order-1',planId:'creator',credits:450,scenes:['tryon','video','edit'],createdAt:'2026-10-28T00:00:00.000Z'}]}));
  await tick();
  assert.equal(orders.getSnapshot().owner,'user-1');assert.equal(orders.getSnapshot().orders.length,1);
  assert.deepEqual(orders.getSnapshot().credits,{'30':2});assert.equal(orders.getSnapshot().packs[0].credits,450);
  assert.equal(orders.getSnapshot().loading,false);assert.equal(orders.getSnapshot().error,'');
  orders.dispose();s.client.clear();
});

test('响应形状不合法时显示固定读取错误并通知，不把脏数据交给界面',async()=>{
  const s=scope(),p=platform(),orders=new SandboxOrders(s,p.value);
  await s.changeIdentity('user-1');p.resolve({orders:[{id:'x',state:'unknown-state',amount:1}],sandboxCredits:{}});await tick();
  assert.equal(orders.getSnapshot().orders.length,0);assert.equal(orders.getSnapshot().error,'订单读取失败。');
  assert.deepEqual(p.notices,[{message:'订单读取失败。',kind:'error'}]);
  const retry=orders.refresh();await tick();p.resolve(view());await retry;
  assert.equal(orders.getSnapshot().error,'');orders.dispose();s.client.clear();
});

test('返回页只在首次读取按订单编号查单；普通刷新只读列表且不自动继续付款',async()=>{
  const s=scope(),p=platform('order-1'),orders=new SandboxOrders(s,p.value);
  await s.changeIdentity('user-1');
  assert.equal(p.calls[0].url,'/api/payments/reconcile');assert.deepEqual(p.calls[0].body,{orderId:'order-1'});
  p.resolve(view([order('order-1')],{url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'}));await tick();
  assert.equal(p.navigations.length,0);assert.equal(orders.getSnapshot().orders[0].state,'pending');
  const next=orders.refresh();await tick();p.resolve(view([order('order-1')]));await next;
  assert.equal(p.calls[1].url,'/api/payments/orders');assert.equal(p.navigations.length,0);
  orders.dispose();s.client.clear();
});

test('显式查单更新状态；仅“继续测试付款”跳转官方收银台，非法链接不跳转',async()=>{
  const s=scope(),p=platform(),orders=new SandboxOrders(s,p.value);
  await s.changeIdentity('user-1');p.resolve(view());await tick();
  const check=orders.reconcile('order-1');await tick();
  assert.equal(p.calls[1].url,'/api/payments/reconcile');assert.deepEqual(p.calls[1].body,{orderId:'order-1'});
  p.resolve(view([order('order-1','paid')]));await check;
  assert.equal(orders.getSnapshot().orders[0].state,'paid');assert.equal(p.navigations.length,0);
  const resume=orders.reconcile('order-1',true);await tick();
  p.resolve(view([order('order-1')],{url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'}));await resume;
  assert.deepEqual(p.navigations,['https://checkout.stripe.com/c/pay/cs_test_synthetic']);
  const invalid=orders.reconcile('order-1',true);await tick();
  p.resolve(view([order('order-1')],{url:'https://invalid.example/c/pay'}));await invalid;
  assert.equal(p.navigations.length,1);assert.equal(orders.getSnapshot().error,'支付链接无法验证。');
  orders.dispose();s.client.clear();
});

test('查单失败保留原列表并提示；换账号取消旧请求，迟到结果不进入新账号',async()=>{
  const s=scope(),p=platform(),orders=new SandboxOrders(s,p.value);
  await s.changeIdentity('user-1');p.resolve(view([order('old')]));await tick();
  const failing=orders.reconcile('old');await tick();p.reject(new Error('支付服务暂不可用。'));await failing;
  assert.equal(orders.getSnapshot().orders[0].id,'old');assert.equal(orders.getSnapshot().error,'支付服务暂不可用。');
  const late=orders.reconcile('old');await tick();
  await s.changeIdentity('user-2');
  assert.equal(p.pending.length,2);
  p.resolve(view([order('stale')]));await tick();await late;
  assert.equal(orders.getSnapshot().owner,'user-2');assert.equal(orders.getSnapshot().orders.length,0);
  p.resolve(view([order('fresh')]));await tick();
  assert.deepEqual(orders.getSnapshot().orders.map(item=>item.id),['fresh']);
  orders.dispose();s.client.clear();
});

test('页面卸载后取消在途读取，迟到响应不写入界面',async()=>{
  const s=scope(),p=platform(),orders=new SandboxOrders(s,p.value);
  await s.changeIdentity('user-1');
  const signal=p.calls[0].signal;
  orders.dispose();
  assert.equal(signal.aborted,true);
  p.resolve(view([order('late')]));await tick();
  assert.equal(orders.getSnapshot().orders.length,0);assert.equal(p.notices.length,0);
  s.client.clear();
});
