import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { SessionScope,createAppQueryClient,StaleIdentityError } from '../src/vue/session-scope';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const setup=()=>{
  const client=createAppQueryClient();
  // Node合同不依赖浏览器五分钟GC，避免取消后的异步收尾留下计时器。
  client.setDefaultOptions({...client.getDefaultOptions(),queries:{...client.getDefaultOptions().queries,gcTime:Infinity}});
  return new SessionScope(client,createPinia());
};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};};

test('换账号推进世代并取消清除私有查询，忽略取消的旧响应不能进入新缓存',async()=>{
  const scope=setup(),old=deferred<string>();await scope.changeIdentity(A);
  scope.client.setQueryData(['public','pricing'],{enabled:false});
  let signal:AbortSignal|undefined,cleaned=0;
  const stop=scope.onIdentityChange(()=>{cleaned++;});
  const pending=scope.query(['works'],async value=>{signal=value;return old.promise;});
  const rejected=assert.rejects(pending);await scope.changeIdentity(B);
  assert.equal(signal?.aborted,true);assert.equal(cleaned,1);assert.equal(scope.state.epoch,2);
  old.resolve('A-private');await rejected;await Promise.resolve();
  assert.equal(scope.client.getQueryCache().findAll({queryKey:['private']}).length,0);
  assert.deepEqual(scope.client.getQueryData(['public','pricing']),{enabled:false});
  assert.equal(await scope.query(['works'],async()=> 'B-private'),'B-private');
  const keys=scope.client.getQueryCache().getAll().map(query=>query.queryKey);
  assert.ok(keys.some(key=>key[0]==='private'&&key[1]===B&&key[2]===2));
  stop();await scope.changeIdentity(null);assert.equal(cleaned,1);scope.client.clear();
});

test('同账号后台读取保持世代，显式重新认证仍隔离旧缓存和在途写入结果',async()=>{
  const scope=setup();await scope.changeIdentity(A);
  await scope.query(['account'],async()=>({synthetic:'A'}));
  assert.equal(await scope.changeIdentity(A),false);assert.equal(scope.state.epoch,1);
  const old=deferred<string>();let calls=0;
  const mutation=scope.mutate(async()=>{calls++;return old.promise;});
  const rejected=assert.rejects(mutation,StaleIdentityError);
  await scope.changeIdentity(A,true);assert.equal(scope.state.epoch,2);
  assert.equal(scope.client.getQueryCache().findAll({queryKey:['private']}).length,0);
  old.resolve('already-committed-upstream');await rejected;assert.equal(calls,1);scope.client.clear();
});

test('旧401不能退出新账号，当前401清缓存并清除身份',async()=>{
  const scope=setup();await scope.changeIdentity(A);const old=scope.capture();
  await scope.changeIdentity(B);assert.equal(await scope.unauthorized(old),false);assert.equal(scope.state.userId,B);
  await scope.query(['account'],async()=>({synthetic:'B'}));
  assert.equal(await scope.unauthorized(scope.capture()),true);assert.equal(scope.state.userId,null);
  assert.equal(scope.client.getQueryCache().getAll().length,0);scope.client.clear();
});

test('缓存命中返回期间切换账号仍拒绝旧值',async()=>{
  const scope=setup();await scope.changeIdentity(A);
  scope.client.setQueryDefaults(['private'],{staleTime:Infinity});
  await scope.query(['account'],async()=> 'A-private');
  let calls=0;const pending=scope.query(['account'],async()=>{calls++;return 'unexpected';});
  const rejected=assert.rejects(pending,StaleIdentityError);await scope.changeIdentity(B);await rejected;
  assert.equal(calls,0);scope.client.clear();
});

test('读写默认不重试，匿名不发私有请求；清理失败仍清缓存且拒绝静默成功',async()=>{
  const scope=setup();let reads=0,writes=0;
  await assert.rejects(scope.query(['works'],async()=>{reads++;return [];}));assert.equal(reads,0);
  await scope.changeIdentity(A);
  await assert.rejects(scope.query(['works'],async()=>{reads++;throw new Error('synthetic');}));assert.equal(reads,1);
  await assert.rejects(scope.mutate(async()=>{writes++;throw new Error('unknown');}));assert.equal(writes,1);
  assert.equal(scope.client.getDefaultOptions().mutations?.retry,false);
  scope.onIdentityChange(()=>{throw new Error('synthetic');});
  await assert.rejects(scope.changeIdentity(null),/资源清理未完成/);
  assert.equal(scope.state.userId,null);assert.equal(scope.client.getQueryCache().getAll().length,0);scope.client.clear();
  await scope.changeIdentity(B).catch(()=>{});
  await assert.rejects(scope.query(['works'],async()=>{reads++;return [];}),/资源清理未完成/);assert.equal(reads,1);
});
