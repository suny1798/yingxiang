import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import { GarmentFavorites,type GarmentFavoritesPlatform } from '../src/vue/garment-favorites';

function fixture(overrides:Partial<GarmentFavoritesPlatform>={}){
  let ids:string[]=[],writes=0,logins=0;
  const scope=new SessionScope(createAppQueryClient(),createPinia());
  const index=new GarmentFavorites(scope,{
    read:async()=>({ids:[...ids]}),
    write:async(_signal,_owner,id,favorite)=>{writes++;ids=favorite?[...ids,id]:ids.filter(value=>value!==id);return {id,favorite};},
    login:()=>{logins++;},...overrides,
  });
  return {scope,index,writes:()=>writes,logins:()=>logins};
}
test('访客点击收藏只提示登录，登录后收藏与取消以服务器确认更新',async()=>{
  const f=fixture();await f.index.toggle('SPR-0001');assert.equal(f.logins(),1);assert.equal(f.writes(),0);
  await f.scope.changeIdentity('owner-a');await f.index.refresh();
  await f.index.toggle('SPR-0001');assert.deepEqual(f.index.getSnapshot().ids,['SPR-0001']);
  await f.index.refresh();assert.deepEqual(f.index.getSnapshot().ids,['SPR-0001']);
  await f.index.toggle('SPR-0001');assert.deepEqual(f.index.getSnapshot().ids,[]);assert.equal(f.writes(),2);f.index.dispose();
});
test('重复点击只写一次，确认之前不显示已收藏',async()=>{
  let resolve!:(value:{id:string;favorite:boolean})=>void,calls=0;
  const f=fixture({write:async()=>{calls++;return new Promise(done=>{resolve=done;});}});
  await f.scope.changeIdentity('owner-a');await f.index.refresh();
  const pending=f.index.toggle('SPR-0001');await f.index.toggle('SPR-0001');
  assert.equal(calls,1);assert.deepEqual(f.index.getSnapshot().ids,[]);
  resolve({id:'SPR-0001',favorite:true});await pending;assert.deepEqual(f.index.getSnapshot().ids,['SPR-0001']);f.index.dispose();
});
test('换账号清空收藏，旧写入迟到不能覆盖新账号；卸载取消读取',async()=>{
  let resolve!:(value:{id:string;favorite:boolean})=>void,signal:AbortSignal|undefined;
  const f=fixture({write:async(current)=>{signal=current;return new Promise(done=>{resolve=done;});}});
  await f.scope.changeIdentity('owner-a');await f.index.refresh();
  const pending=f.index.toggle('SPR-0001');await f.scope.changeIdentity('owner-b');await f.index.refresh();
  assert.equal(signal?.aborted,true);resolve({id:'SPR-0001',favorite:true});await pending;
  assert.deepEqual(f.index.getSnapshot().ids,[]);assert.equal(f.index.getSnapshot().owner,'owner-b');
  f.index.dispose();await f.index.toggle('SPR-0001');assert.deepEqual(f.index.getSnapshot().ids,[]);
});
test('失败不伪报收藏成功、不重试写入，重新读取后才恢复操作',async()=>{
  let calls=0;
  const f=fixture({write:async()=>{calls++;throw new Error('network');}});
  await f.scope.changeIdentity('owner-a');await f.index.refresh();await f.index.toggle('SPR-0001');
  assert.deepEqual(f.index.getSnapshot().ids,[]);assert.match(f.index.getSnapshot().error!,/未确认/);
  await f.index.toggle('SPR-0001');assert.equal(calls,1);await f.index.refresh();assert.equal(f.index.getSnapshot().error,null);f.index.dispose();
});
test('身份变化后的旧读取、未知编号、未确认读取失败不能污染或新增收藏',async()=>{
  let resolve!:(value:{ids:string[]})=>void;
  const f=fixture({read:async(_signal,owner)=>owner==='owner-a'?new Promise(done=>{resolve=done;}):{ids:['AUT-0001','invalid']}});
  await f.scope.changeIdentity('owner-a');const pending=f.index.refresh();await f.scope.changeIdentity('owner-b');await f.index.refresh();
  resolve({ids:['SPR-0001']});await pending;assert.deepEqual(f.index.getSnapshot().ids,['AUT-0001']);
  await f.index.toggle('../../secret');assert.equal(f.writes(),0);f.index.dispose();
});
