import assert from 'node:assert/strict';
import test from 'node:test';
import { SandboxCheckout } from '../src/lib/sandbox-checkout';
import type { AccountView } from '../src/lib/account';
const view=(id:string)=>({user:{id}} as AccountView);
function deferred<T>() { let resolve!:(value:T)=>void,reject!:(reason?:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('支付读取失败或非布尔开放值关闭提交，匿名只请求登录',async()=>{
  for(const enabled of [true,'true']) {
    let login=0,posts=0;
    const controller=new SandboxCheckout({request:async(url)=>{if(url.endsWith('/status'))return {testEnabled:enabled};posts++;return{};},
      userId:()=>undefined,refresh:async()=>null,openLogin:()=>{login++;},navigate:()=>assert.fail('unexpected navigation'),requestId:()=>assert.fail('anonymous operation')});
    await controller.load();await controller.buy('credits-v1-creator');
    assert.equal(login,enabled===true?1:0);assert.equal(posts,0);controller.dispose();
  }
  const controller=new SandboxCheckout({request:async()=>{throw new Error('synthetic offline');},userId:()=>undefined,refresh:async()=>null,openLogin(){},navigate(){},requestId:()=>''});
  await controller.load();assert.deepEqual(controller.getSnapshot(),{enabled:false,ready:true,busy:false,error:'支付服务暂不可用。'});controller.dispose();
});

test('同一未知订单手动重试复用UUID，并发点击不多发，换商品另建操作',async()=>{
  let ids=0,first=true;const bodies:object[]=[],destinations:string[]=[];const pending=deferred<Record<string,unknown>>();
  const controller=new SandboxCheckout({request:async(url,body)=>{if(url.endsWith('/status'))return{testEnabled:true};bodies.push(body!);if(first)return pending.promise;return{url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'};},
    userId:()=>'synthetic-user',refresh:async()=>view('synthetic-user'),openLogin:()=>assert.fail('unexpected login'),navigate:url=>destinations.push(url),requestId:()=>`synthetic-id-${++ids}`});
  await controller.load();const firstBuy=controller.buy('credits-v1-creator');await tick();
  await Promise.all([controller.buy('credits-v1-creator'),controller.buy('credits-v1-creator')]);assert.equal(bodies.length,1);
  pending.reject(new Error('synthetic unknown'));await firstBuy;assert.equal(destinations.length,0);assert.equal(controller.getSnapshot().busy,false);
  first=false;await controller.buy('credits-v1-creator');assert.deepEqual(bodies[0],bodies[1]);assert.equal(ids,1);
  await controller.buy('credits-v1-plus');assert.equal(ids,2);assert.equal(destinations.length,2);controller.dispose();
});

test('账号在复核或订单响应期间变化时不挪用购买，也不跳转迟到结果',async()=>{
  let user='A',posts=0;const pending=deferred<Record<string,unknown>>();
  const controller=new SandboxCheckout({request:async(url)=>{if(url.endsWith('/status'))return{testEnabled:true};posts++;return pending.promise;},
    userId:()=>user,refresh:async()=>{user='B';return view('A');},openLogin(){},navigate:()=>assert.fail('changed user navigation'),requestId:()=>''});
  await controller.load();await controller.buy('credits-v1-light');assert.equal(posts,0);assert.match(controller.getSnapshot().error,/登录状态已变化/);controller.dispose();
  user='A';const next=new SandboxCheckout({request:async(url)=>url.endsWith('/status')?{testEnabled:true}:pending.promise,
    userId:()=>user,refresh:async()=>view('A'),openLogin(){},navigate:()=>assert.fail('late result navigation'),requestId:()=>'synthetic-id'});
  await next.load();const buy=next.buy('credits-v1-light');await tick();user='B';pending.resolve({url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'});await buy;
  assert.match(next.getSnapshot().error,/登录状态已变化/);next.dispose();
});

test('页面离开后迟到订单不跳转，非法收银台链接拒绝',async()=>{
  const pending=deferred<Record<string,unknown>>();let navigations=0;
  const dependencies={request:async(url:string)=>url.endsWith('/status')?{testEnabled:true}:pending.promise,userId:()=>'A',refresh:async()=>view('A'),openLogin(){},navigate(){navigations++;},requestId:()=>'synthetic-id'};
  const controller=new SandboxCheckout(dependencies);await controller.load();const buy=controller.buy('credits-v1-light');await tick();controller.dispose();pending.resolve({url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'});await buy;assert.equal(navigations,0);
  const invalid=new SandboxCheckout({...dependencies,request:async(url)=>url.endsWith('/status')?{testEnabled:true}:{url:'https://invalid.example'}});
  await invalid.load();await invalid.buy('credits-v1-light');assert.equal(navigations,0);assert.equal(invalid.getSnapshot().error,'支付链接无法验证。');invalid.dispose();
});

test('同一账号重新认证使旧购买响应失效，未知操作仅显式重试复用原ID',async()=>{
  let epoch=1,posts=0,ids=0,navigations=0;const pending=deferred<Record<string,unknown>>(),bodies:object[]=[];
  const controller=new SandboxCheckout({request:async(url,body)=>{if(url.endsWith('/status'))return{testEnabled:true};bodies.push(body!);posts++;return posts===1?pending.promise:{url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'};},
    userId:()=>'A',identityEpoch:()=>epoch,refresh:async()=>view('A'),openLogin(){},navigate(){navigations++;},requestId:()=>`synthetic-${++ids}`});
  await controller.load();const buy=controller.buy('credits-v1-light');await tick();epoch++;
  pending.resolve({url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'});await buy;
  assert.equal(navigations,0);assert.match(controller.getSnapshot().error,/登录状态已变化/);
  assert.equal(posts,1);await controller.buy('credits-v1-light');assert.equal(posts,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal(ids,1);assert.equal(navigations,1);controller.dispose();
});
