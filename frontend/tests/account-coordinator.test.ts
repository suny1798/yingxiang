import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { AccountCoordinator } from '../src/vue/account-coordinator';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import type { AccountView } from '../src/lib/account';
import type { IdentitySignals,IdentitySignal } from '../src/vue/identity-signals';
const account=(name:string|null):AccountView=>({user:name?{id:name==='alpha'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',username:name,createdAt:'2026-10-28T00:00:00Z',role:'user'}:null,trial:name?'ready':null,trialLimit:name?1:0,trialRemaining:name?1:0,durations:[],history:[]});
const deferred=()=>{let resolve!:(value:Response)=>void;const promise=new Promise<Response>(r=>{resolve=r;});return {resolve,promise};};
function setup(request:(url:string,init:RequestInit)=>Promise<Response>,signals?:IdentitySignals,timeout?:number){const client=createAppQueryClient();client.setDefaultOptions({...client.getDefaultOptions(),queries:{...client.getDefaultOptions().queries,gcTime:Infinity}});const scope=new SessionScope(client,createPinia());return new AccountCoordinator(scope,request,signals,timeout);}

test('全站读取合并在途请求，显式读取取消并隔离迟到旧身份',async()=>{
  const old=deferred();let calls=0,signal:AbortSignal|undefined;
  const coordinator=setup(async(_url,init)=>{calls++;if(calls===1){signal=init.signal!;return old.promise;}return Response.json(account('beta'));});
  const first=coordinator.revalidate();assert.equal(coordinator.revalidate(),first);
  await coordinator.refresh();assert.equal(signal?.aborted,true);
  old.resolve(Response.json(account('alpha')));assert.equal(await first,null);
  assert.equal(coordinator.getSnapshot().account?.user?.username,'beta');assert.equal(calls,2);
  assert.ok(coordinator.scope.client.getQueryData(['private',account('beta').user!.id,1,'account']));
  await coordinator.dispose();
});

test('认证写入之前清空旧身份与缓存，同账号重新登录也换代并以本人读取证明',async()=>{
  let posts=0,reads=0;let coordinator:AccountCoordinator;
  coordinator=setup(async(url,init)=>{
    if(init.method==='POST'){posts++;assert.equal(coordinator.getSnapshot().account,null);assert.equal(coordinator.scope.state.userId,null);assert.equal(coordinator.scope.client.getQueryCache().findAll({queryKey:['private']}).length,0);return Response.json({accepted:true});}
    reads++;return Response.json(account('alpha'));
  });
  await coordinator.refresh();const epoch=coordinator.scope.state.epoch;
  await coordinator.authenticate(false,'alpha','Synthetic-Only-123');
  assert.equal(posts,1);assert.equal(reads,2);assert.ok(coordinator.scope.state.epoch>epoch);
  assert.equal(coordinator.getSnapshot().account?.user?.username,'alpha');await coordinator.dispose();
});

test('结果未知只核查当前Cookie、不补发POST，错误不泄露底层诊断',async()=>{
  let posts=0;
  const coordinator=setup(async(_url,init)=>{if(init.method==='POST'){posts++;throw new Error('sensitive diagnostic');}return Response.json(account('alpha'));});
  await coordinator.refresh();await assert.rejects(coordinator.logout(),error=>error instanceof Error&&error.message.includes('不要重复提交')&&!error.message.includes('diagnostic'));
  assert.equal(posts,1);assert.equal(coordinator.getSnapshot().account?.user?.username,'alpha');assert.equal(coordinator.getSnapshot().busy,false);await coordinator.dispose();
});

test('失败读取保留已确认显示，认证仍需本人再确认，不能用旧缓存宣称成功',async()=>{
  let fail=false,posts=0;
  const coordinator=setup(async(_url,init)=>{if(init.method==='POST'){posts++;return Response.json({});}if(fail)throw new Error('synthetic');return Response.json(account('alpha'));});
  await coordinator.refresh();fail=true;assert.equal(await coordinator.refresh(),null);assert.equal(coordinator.getSnapshot().account?.user?.username,'alpha');assert.ok(coordinator.getSnapshot().error);
  await assert.rejects(coordinator.authenticate(false,'alpha','Synthetic-Only-123'));assert.equal(posts,1);assert.equal(coordinator.getSnapshot().account,null);await coordinator.dispose();
});

test('认证进行中拒绝重复写入；退出需确认匿名，卸载后迟到读取不再提交',async()=>{
  let posts=0;const post=deferred();
  const coordinator=setup(async(_url,init)=>init.method==='POST'?(posts++,post.promise):Response.json(account(null)));
  const logout=coordinator.logout();await Promise.resolve();
  await assert.rejects(coordinator.logout());assert.equal(await coordinator.revalidate(),null);
  post.resolve(Response.json({accepted:true}));await logout;assert.equal(posts,1);assert.equal(coordinator.getSnapshot().account?.user,null);
  const old=deferred(),other=setup(async()=>old.promise);const pending=other.refresh();await other.dispose();old.resolve(Response.json(account('alpha')));assert.equal(await pending,null);assert.equal(other.getSnapshot().account,null);await coordinator.dispose();
});

test('当前本人401清除身份和私有缓存，迟到的旧401不退出新账号',async()=>{
  let unauthorized=false;const old=deferred();let calls=0;
  const coordinator=setup(async()=>{calls++;if(calls===2)return old.promise;return unauthorized?Response.json({}, {status:401}):Response.json(account(calls<3?'alpha':'beta'));});
  await coordinator.refresh();const pending=coordinator.refresh();await coordinator.refresh();
  old.resolve(Response.json({}, {status:401}));await pending;assert.equal(coordinator.getSnapshot().account?.user?.username,'beta');
  unauthorized=true;const anonymous=await coordinator.refresh();assert.equal(anonymous?.user,null);assert.equal(coordinator.scope.state.userId,null);assert.equal(coordinator.scope.client.getQueryCache().getAll().length,0);await coordinator.dispose();
});

test('请求同步抛错后仍可重读，不把已结束的失败Promise当作在途请求',async()=>{
  let fail=true;const coordinator=setup(()=>{if(fail)throw new Error('synthetic');return Promise.resolve(Response.json(account('alpha')));});
  assert.equal(await coordinator.revalidate(),null);fail=false;
  assert.equal((await coordinator.revalidate())?.user?.username,'alpha');await coordinator.dispose();
});

test('同一UUID角色变化也推进世代，撤销后不能复用管理员查询缓存',async()=>{
  let role:'user'|'admin'='user';const coordinator=setup(async()=>Response.json({...account('alpha'),user:{...account('alpha').user!,role}}));
  await coordinator.refresh();const first=coordinator.scope.state.epoch;role='admin';await coordinator.refresh();assert.ok(coordinator.scope.state.epoch>first);
  const key=['private',account('alpha').user!.id,coordinator.scope.state.epoch,'admin'];coordinator.scope.client.setQueryData(key,{synthetic:'private-admin'});
  const promoted=coordinator.scope.state.epoch;role='user';await coordinator.refresh();assert.ok(coordinator.scope.state.epoch>promoted);assert.equal(coordinator.scope.client.getQueryData(key),undefined);await coordinator.dispose();
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function signalHub(){
  const listeners=new Set<(signal:IdentitySignal)=>void>(),sent:IdentitySignal[]=[];
  return {sent,connect():IdentitySignals{let own:((signal:IdentitySignal)=>void)|undefined;return {
    publish(signal){sent.push(signal);for(const listener of listeners)if(listener!==own)queueMicrotask(()=>{if(listeners.has(listener))listener(signal);});},
    subscribe(listener){own=listener;listeners.add(listener);return ()=>{listeners.delete(listener);};},close(){if(own)listeners.delete(own);},
  };}};
}

test('跨标签同账号重新认证先隔离旧查询，完成信号只触发本人读取、不复制身份',async()=>{
  const hub=signalHub(),post=deferred();let posts=0;
  const request=async(_url:string,init:RequestInit)=>init.method==='POST'?(posts++,post.promise):Response.json(account('alpha'));
  const sender=setup(request,hub.connect()),peer=setup(request,hub.connect());await sender.refresh();await peer.refresh();const epoch=peer.scope.state.epoch;
  const old=deferred();let signal:AbortSignal|undefined;
  const query=peer.scope.query(['works'],async value=>{signal=value;await old.promise;return 'old-private';});const rejected=assert.rejects(query);
  const login=sender.authenticate(false,'alpha','Synthetic-Only-123');await tick();
  assert.equal(peer.getSnapshot().account,null);assert.equal(peer.getSnapshot().busy,true);assert.equal(signal?.aborted,true);
  await assert.rejects(peer.scope.query(['works'],async()=>[]),/处理中/);old.resolve(Response.json({}));await rejected;
  post.resolve(Response.json({accepted:true}));await login;for(let n=0;n<20&&peer.getSnapshot().busy;n++)await tick();await tick();
  assert.equal(peer.getSnapshot().account?.user?.username,'alpha');assert.ok(peer.scope.state.epoch>epoch);assert.equal(posts,1);
  assert.deepEqual(hub.sent.map(signal=>Object.keys(signal).sort()),[['id','phase'],['id','phase']]);
  await sender.dispose();await peer.dispose();
});

test('远端标签中断后有界核查恢复，卸载取消信号与恢复计时器',async()=>{
  const hub=signalHub(),sender=hub.connect();let reads=0;
  const peer=setup(async()=>{reads++;return Response.json(account('alpha'));},hub.connect(),10);
  await peer.refresh();sender.publish({phase:'changing',id:'synthetic-interrupted'});await tick();assert.equal(peer.getSnapshot().busy,true);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(peer.getSnapshot().busy,false);assert.equal(peer.getSnapshot().account?.user?.username,'alpha');assert.equal(reads,2);
  sender.publish({phase:'changing',id:'synthetic-dispose'});await tick();await peer.dispose();const before=reads;sender.publish({phase:'settled',id:'synthetic-dispose'});await new Promise(resolve=>setTimeout(resolve,25));assert.equal(reads,before);sender.close();
});
