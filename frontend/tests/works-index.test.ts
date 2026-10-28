import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import type { WorkItem,WorkPage } from '../src/lib/api-schema';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import { WorksIndex,type WorksFilters,type WorksPlatform } from '../src/vue/works-index';
const scope=()=>new SessionScope(createAppQueryClient(),createPinia());
const work=(id:string,title:string,over:Partial<WorkItem>={}):WorkItem=>({id,kind:'realtime',title,state:'ready',createdAt:'2026-10-28T00:00:00.000Z',updatedAt:'2026-10-28T00:00:00.000Z',bytes:10,seconds:15,extension:'webm',message:null,canRetry:false,favorite:false,contentUrl:`/api/works/${id}/content`,references:[],...over});
const page=(items:WorkItem[],over:Partial<WorkPage>={}):WorkPage=>({items,page:1,pageSize:9,pages:1,total:items.length,...over});

function platform(){
  const calls:WorksFilters[]=[],notices:Array<{message:string;kind:string}>=[];
  const loads:Array<{resolve:(value:WorkPage)=>void;reject:(error:unknown)=>void}>=[],favorites:Array<{resolve:(value:WorkItem)=>void;reject:(error:unknown)=>void}>=[];
  let hidden=false;
  const value:WorksPlatform={
    fetchWorks:(signal,filters)=>{calls.push(filters);return new Promise<WorkPage>((resolve,reject)=>{loads.push({resolve,reject});});},
    setFavorite:()=>new Promise<WorkItem>((resolve,reject)=>{favorites.push({resolve,reject});}),
    hidden:()=>hidden,
    notify:(message,kind)=>{notices.push({message,kind});},
    translate:(message)=>`[en]${message}`,
  };
  return {value,calls,notices,loads,favorites,resolveLoad:(result:WorkPage)=>loads.shift()!.resolve(result),rejectLoad:(error:unknown)=>loads.shift()!.reject(error),resolveFavorite:(result:WorkItem)=>favorites.shift()!.resolve(result),rejectFavorite:(error:unknown)=>favorites.shift()!.reject(error),setHidden:(next:boolean)=>{hidden=next;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('未登录不发私有请求；登录后按默认参数加载并保持筛选、搜索、排序与分页边界',async()=>{
  const s=scope(),p=platform(),index=new WorksIndex(s,p.value);
  await index.refresh();assert.equal(p.calls.length,0);assert.equal(index.getSnapshot().owner,null);
  await s.changeIdentity('user-1');
  assert.deepEqual(p.calls[0],{kind:'all',page:1,query:'',sort:'newest',favoritesOnly:false});
  p.resolveLoad(page([work('w1','春日试衣')]));await tick();
  assert.equal(index.getSnapshot().owner,'user-1');assert.equal(index.getSnapshot().list?.total,1);assert.equal(index.getSnapshot().loading,false);
  index.setKind('video');assert.equal(p.calls[1].kind,'video');assert.equal(p.calls[1].page,1);p.resolveLoad(page([]));await tick();
  index.setPage(2);assert.equal(p.calls[2].page,2);p.resolveLoad(page([],{page:2,pages:2}));await tick();
  index.setSearchInput('  春日  ');index.submitSearch();assert.equal(p.calls[3].query,'春日');assert.equal(p.calls[3].page,1);p.resolveLoad(page([]));await tick();
  index.setSort('title');assert.equal(p.calls[4].sort,'title');assert.equal(p.calls[4].page,1);p.resolveLoad(page([]));await tick();
  index.toggleFavorites();assert.equal(p.calls[5].favoritesOnly,true);p.resolveLoad(page([]));await tick();
  index.clearFilters();assert.deepEqual(p.calls[6],{kind:'all',page:1,query:'',sort:'newest',favoritesOnly:false});p.resolveLoad(page([]));await tick();
  index.dispose();s.client.clear();
});

test('首次加载显示错误并可重试，加载中不覆盖已有列表',async()=>{
  const s=scope(),p=platform(),index=new WorksIndex(s,p.value);
  await s.changeIdentity('user-1');p.rejectLoad(new Error('作品暂时无法读取，请稍后重试。'));await tick();
  assert.equal(index.getSnapshot().error,'作品暂时无法读取，请稍后重试。');assert.equal(index.getSnapshot().list,null);assert.equal(index.getSnapshot().loading,false);
  const retry=index.refresh();assert.equal(index.getSnapshot().loading,true);p.resolveLoad(page([work('w1','一')]));await retry;
  assert.equal(index.getSnapshot().error,null);assert.equal(index.getSnapshot().list?.items[0].title,'一');
  const silent=index.refresh(true);assert.equal(index.getSnapshot().loading,false);p.resolveLoad(page([work('w2','二')]));await silent;
  assert.equal(index.getSnapshot().list?.items[0].title,'二');
  index.dispose();s.client.clear();
});

test('换账号取消旧请求并丢弃迟到列表，不把旧账号作品交给新账号',async()=>{
  const s=scope(),p=platform(),index=new WorksIndex(s,p.value);
  await s.changeIdentity('user-1');
  await s.changeIdentity('user-2');
  assert.equal(p.calls.length,2);
  p.resolveLoad(page([work('old','旧账号')]));await tick();
  assert.equal(index.getSnapshot().owner,null);assert.equal(index.getSnapshot().list,null);
  p.resolveLoad(page([work('new','新账号')]));await tick();
  assert.equal(index.getSnapshot().owner,'user-2');assert.equal(index.getSnapshot().list?.items[0].title,'新账号');
  await s.changeIdentity(null,true);assert.equal(index.getSnapshot().list,null);assert.equal(index.getSnapshot().owner,null);assert.equal(p.calls.length,2);
  index.dispose();s.client.clear();
});

test('收藏成功更新当前列表并静默刷新，失败只通知且释放忙碌状态',async()=>{
  const s=scope(),p=platform(),index=new WorksIndex(s,p.value);
  await s.changeIdentity('user-1');p.resolveLoad(page([work('w1','春日')]));await tick();
  const toggling=index.toggleFavorite(work('w1','春日'));
  assert.equal(index.getSnapshot().favoriteBusy,'w1');
  p.resolveFavorite(work('w1','春日',{favorite:true}));await tick();
  assert.equal(index.getSnapshot().list?.items[0].favorite,true);
  assert.deepEqual(p.notices[0],{message:'[en]已加入收藏，可通过“仅看收藏”找到它。',kind:'success'});
  assert.equal(p.calls.length,2);p.resolveLoad(page([work('w1','春日',{favorite:true})]));await toggling;
  assert.equal(index.getSnapshot().favoriteBusy,null);
  const failing=index.toggleFavorite(work('w1','春日',{favorite:true}));p.rejectFavorite(new Error('收藏状态未能更新。'));await failing;
  assert.deepEqual(p.notices[1],{message:'[en]收藏状态未能更新。',kind:'error'});assert.equal(index.getSnapshot().favoriteBusy,null);
  index.dispose();s.client.clear();
});

test('不可见时不轮询，可见时静默刷新；卸载取消在途请求',async()=>{
  const s=scope(),p=platform(),index=new WorksIndex(s,p.value);
  await s.changeIdentity('user-1');p.resolveLoad(page([work('w1','一')]));await tick();
  p.setHidden(true);index.poll();assert.equal(p.calls.length,1);
  p.setHidden(false);index.poll();assert.equal(p.calls.length,2);
  index.dispose();p.resolveLoad(page([work('w2','二')]));await tick();
  assert.equal(index.getSnapshot().list?.items[0].title,'一');s.client.clear();
});
