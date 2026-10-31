import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminConsole,AdminRequestError,type AdminPlatform } from '../src/vue/admin';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function platform() {
  const calls:Array<{path:string;body:Record<string,unknown>;signal:AbortSignal}>=[];
  const pending:Array<{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>=[];
  const notices:Array<{message:string;kind:string}>=[];
  let ids=0,refreshed=0;
  const value:AdminPlatform={
    request:<T,>(path:string,body:unknown,signal:AbortSignal)=>{calls.push({path,body:body as Record<string,unknown>,signal});return new Promise<T>((resolve,reject)=>{pending.push({resolve:resolve as (value:unknown)=>void,reject});});},
    requestId:()=>`op-${++ids}`,
    notify:(message,kind)=>notices.push({message,kind}),
    savedMessage:()=>'saved',
    failedMessage:()=>'failed',
    refreshAccount:()=>{refreshed++;},
  };
  return {value,calls,pending,notices,get ids(){return ids;},get refreshed(){return refreshed;},resolve:(result:unknown)=>pending.shift()!.resolve(result),reject:(error:unknown)=>pending.shift()!.reject(error)};
}

const quota={path:'/api/admin/users/u1/credits',body:{delta:2,reason:'自动化回归测试'},summary:'u1\n+2 积分'};

test('确认前不写入；确认后只发一次POST并带操作编号，成功后清空待确认并刷新',async()=>{
  const p=platform(),admin=new AdminConsole(p.value);
  admin.prepare(quota);
  assert.equal(p.calls.length,0);assert.equal(admin.getSnapshot().pending?.summary,quota.summary);
  const first=admin.save();await tick();
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].path,quota.path);assert.equal(p.calls[0].body.requestId,'op-1');assert.equal(admin.getSnapshot().busy,true);
  const duplicate=admin.save();await tick();assert.equal(p.calls.length,1);
  p.resolve({accepted:true});await Promise.all([first,duplicate]);
  assert.equal(admin.getSnapshot().pending,null);assert.equal(admin.getSnapshot().busy,false);assert.equal(admin.getSnapshot().revision,1);
  assert.deepEqual(p.notices,[{message:'saved',kind:'success'}]);assert.equal(p.refreshed,1);
  admin.dispose();
});

test('写入失败保留待确认并复用同一操作编号，不自动重试；修改内容后另建操作',async()=>{
  const p=platform(),admin=new AdminConsole(p.value);
  admin.prepare(quota);
  const first=admin.save();await tick();p.reject(new AdminRequestError('设置已被更新，请刷新后重新确认。',409));await first;
  assert.equal(p.calls.length,1);assert.equal(admin.getSnapshot().pending?.summary,quota.summary);
  assert.equal(admin.getSnapshot().error,'设置已被更新，请刷新后重新确认。');assert.equal(admin.getSnapshot().revision,0);
  assert.deepEqual(p.notices,[{message:'设置已被更新，请刷新后重新确认。',kind:'error'}]);
  const retry=admin.save();await tick();
  assert.equal(p.calls.length,2);assert.equal(p.calls[1].body.requestId,'op-1');assert.equal(p.ids,1);
  p.resolve({accepted:true});await retry;
  admin.prepare({...quota,summary:'u1\n30s · +3'});
  const changed=admin.save();await tick();
  assert.equal(p.calls[2].body.requestId,'op-2');p.resolve({accepted:true});await changed;
  admin.dispose();
});

test('写入时权限已失效立即隐藏管理数据并停止待确认',async()=>{
  const p=platform(),admin=new AdminConsole(p.value);
  admin.prepare(quota);
  const first=admin.save();await tick();p.reject(new AdminRequestError('需要管理员权限。',403));await first;
  assert.equal(admin.getSnapshot().denied,true);assert.equal(admin.getSnapshot().pending,null);assert.equal(admin.getSnapshot().revision,0);
  assert.equal(p.refreshed,1);assert.equal(admin.getSnapshot().error,'需要管理员权限。');
  admin.dispose();
});

test('页面卸载中止在途写入，迟到结果不更新界面也不通知',async()=>{
  const p=platform(),admin=new AdminConsole(p.value);
  admin.prepare(quota);
  const first=admin.save();await tick();
  assert.equal(p.calls[0].signal.aborted,false);
  admin.dispose();
  assert.equal(p.calls[0].signal.aborted,true);
  p.resolve({accepted:true});await first;
  assert.equal(admin.getSnapshot().pending?.summary,quota.summary);assert.equal(admin.getSnapshot().revision,0);
  assert.equal(p.notices.length,0);
});

test('标签切换与刷新受写入中状态保护，读取版本只在允许时推进',async()=>{
  const p=platform(),admin=new AdminConsole(p.value);
  admin.select('users');assert.equal(admin.getSnapshot().tab,'users');
  admin.prepare(quota);admin.select('audit');assert.equal(admin.getSnapshot().tab,'audit');
  const first=admin.save();await tick();
  admin.select('settings');admin.refresh();
  assert.equal(admin.getSnapshot().tab,'audit');assert.equal(admin.getSnapshot().revision,0);assert.equal(p.refreshed,0);
  p.resolve({accepted:true});await first;
  admin.refresh();assert.equal(admin.getSnapshot().revision,2);assert.equal(p.refreshed,2);
  admin.close();assert.equal(admin.getSnapshot().pending,null);
  admin.dispose();
});
