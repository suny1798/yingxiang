import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { LocalFrameTools,type FrameHost,type FrameToolsPlatform } from '../src/vue/frame-tools';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';

class Host implements FrameHost {
  hidden=false;fullscreenEnabled=true;fullscreenElement:Element|null=null;fail=false;
  requests:Element[]=[];exits=0;
  private full=new Set<()=>void>();private visible=new Set<()=>void>();private pagehide=new Set<()=>void>();
  get listenerCount(){return this.full.size+this.visible.size+this.pagehide.size;}
  async requestFullscreen(element:Element){if(this.fail)throw new Error('denied');this.requests.push(element);this.fullscreenElement=element;this.full.forEach(listener=>listener());}
  async exitFullscreen(){this.exits++;this.fullscreenElement=null;this.full.forEach(listener=>listener());}
  onFullscreenChange(listener:()=>void){this.full.add(listener);return()=>{this.full.delete(listener);};}
  onHidden(listener:()=>void){this.visible.add(listener);return()=>{this.visible.delete(listener);};}
  onPageHide(listener:()=>void){this.pagehide.add(listener);return()=>{this.pagehide.delete(listener);};}
  emitHidden(value:boolean){this.hidden=value;this.visible.forEach(listener=>listener());}
  emitPageHide(){this.pagehide.forEach(listener=>listener());}
}

type Pending={resolve:(blob:Blob)=>void;reject:(error:unknown)=>void;mirrored:boolean;video:HTMLVideoElement|null};
function platform(){
  const queue:Pending[]=[],downloads:Array<{filename:string;size:number}>=[],notices:Array<{message:string;kind:string}>=[];
  const value:FrameToolsPlatform={
    capture:(video,mirrored)=>new Promise<Blob>((resolve,reject)=>{queue.push({resolve,reject,mirrored,video});}),
    download:(blob,filename)=>{downloads.push({filename,size:blob.size});},
    stamp:()=>'2026-10-28T00-00-00-000Z',
    notify:(message,kind)=>{notices.push({message,kind});},
    translate:(message)=>`[en]${message}`,
  };
  return {value,queue,downloads,notices};
}
function fixture(scope?:SessionScope,fullscreenEnabled=true){
  const host=new Host(),p=platform(),stage={} as HTMLElement,video={} as HTMLVideoElement;
  host.fullscreenEnabled=fullscreenEnabled;
  const tools=new LocalFrameTools(host,p.value,{stage:()=>stage,video:()=>video,stem:()=>'映想-相机原画',scope});
  return {host,p,stage,video,tools};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('默认镜像开启、全屏支持按浏览器能力读取，切换镜像只发布快照',()=>{
  const f=fixture();assert.deepEqual(f.tools.getSnapshot(),{mirrored:true,fullscreen:false,supported:true,capturing:false});
  let published=0;const stop=f.tools.subscribe(()=>published++);
  f.tools.toggleMirror();assert.equal(f.tools.getSnapshot().mirrored,false);assert.equal(published,1);
  f.tools.toggleMirror();assert.equal(f.tools.getSnapshot().mirrored,true);assert.equal(published,2);
  stop();f.tools.toggleMirror();assert.equal(published,2);f.tools.dispose();
  const unsupported=fixture(undefined,false);assert.equal(unsupported.tools.getSnapshot().supported,false);unsupported.tools.dispose();
});

test('视频页可显式关闭初始镜像，状态与截图读取同一来源',()=>{
  const host=new Host(),p=platform();
  const tools=new LocalFrameTools(host,p.value,{stage:()=>null,video:()=>null,stem:()=>'x',mirrored:false});
  assert.equal(tools.getSnapshot().mirrored,false);
  tools.toggleMirror();assert.equal(tools.getSnapshot().mirrored,true);tools.dispose();
});

test('截图使用点击时镜像与当前视频，重复点击只导出一次，成功后恢复可再次操作',async()=>{
  const f=fixture(),running=f.tools.capture();
  assert.equal(f.tools.getSnapshot().capturing,true);
  await f.tools.capture();assert.equal(f.p.queue.length,1);
  f.tools.toggleMirror();
  f.p.queue[0].resolve(new Blob(['png']));await running;
  assert.equal(f.p.queue[0].mirrored,true);assert.equal(f.p.queue[0].video,f.video);
  assert.deepEqual(f.p.downloads,[{filename:'映想-相机原画-2026-10-28T00-00-00-000Z',size:3}]);
  assert.deepEqual(f.p.notices,[{message:'[en]已导出当前画面，截图仅保存在你选择的位置。',kind:'success'}]);
  assert.equal(f.tools.getSnapshot().capturing,false);
  const next=f.tools.capture();assert.equal(f.p.queue.length,2);assert.equal(f.p.queue[1].mirrored,false);
  f.p.queue[1].resolve(new Blob(['png']));await next;assert.equal(f.p.downloads.length,2);
  f.tools.dispose();
});

test('空帧或编码失败给出翻译后的错误且不下载，非Error失败回到固定提示',async()=>{
  const f=fixture(),first=f.tools.capture();f.p.queue[0].reject(new Error('视频画面尚未就绪，请播放后再截图。'));await first;
  assert.equal(f.p.downloads.length,0);
  assert.deepEqual(f.p.notices,[{message:'[en]视频画面尚未就绪，请播放后再截图。',kind:'error'}]);
  assert.equal(f.tools.getSnapshot().capturing,false);
  const second=f.tools.capture();f.p.queue[1].reject('synthetic');await second;
  assert.deepEqual(f.p.notices[1],{message:'[en]截图未完成，请稍后重试。',kind:'error'});assert.equal(f.p.downloads.length,0);
  f.tools.dispose();
});

test('隐藏、pagehide、换账号或卸载后到达的截图不下载不通知',async()=>{
  const hidden=fixture(),hiddenRun=hidden.tools.capture();hidden.host.emitHidden(true);
  assert.equal(hidden.tools.getSnapshot().capturing,false);
  hidden.p.queue[0].resolve(new Blob(['png']));await hiddenRun;assert.equal(hidden.p.downloads.length,0);assert.equal(hidden.p.notices.length,0);
  hidden.tools.dispose();

  const pagehide=fixture(),pagehideRun=pagehide.tools.capture();pagehide.host.emitPageHide();pagehide.p.queue[0].resolve(new Blob(['png']));await pagehideRun;
  assert.equal(pagehide.p.downloads.length,0);assert.equal(pagehide.p.notices.length,0);pagehide.tools.dispose();

  const scope=new SessionScope(createAppQueryClient(),createPinia()),identity=fixture(scope),identityRun=identity.tools.capture();
  await scope.changeIdentity('other-user',true);identity.p.queue[0].resolve(new Blob(['png']));await identityRun;
  assert.equal(identity.p.downloads.length,0);assert.equal(identity.p.notices.length,0);identity.tools.dispose();scope.client.clear();

  const disposed=fixture(),disposedRun=disposed.tools.capture();disposed.tools.dispose();disposed.p.queue[0].resolve(new Blob(['png']));await disposedRun;
  assert.equal(disposed.p.downloads.length,0);assert.equal(disposed.p.notices.length,0);assert.equal(disposed.host.listenerCount,0);
});

test('取消后重新截图仍可导出，取消不会停掉预览或视频元素',async()=>{
  const f=fixture(),first=f.tools.capture();f.tools.cancel();assert.equal(f.tools.getSnapshot().capturing,false);
  f.p.queue[0].resolve(new Blob(['png']));await first;assert.equal(f.p.downloads.length,0);
  const second=f.tools.capture();f.p.queue[1].resolve(new Blob(['png']));await second;assert.equal(f.p.downloads.length,1);
  f.tools.dispose();
});

test('全屏进入、退出与拒绝都可观察，缺画框时不抛异常',async()=>{
  const f=fixture();
  await f.tools.toggleFullscreen();assert.deepEqual(f.host.requests,[f.stage]);assert.equal(f.tools.getSnapshot().fullscreen,true);
  await f.tools.toggleFullscreen();assert.equal(f.host.exits,1);assert.equal(f.tools.getSnapshot().fullscreen,false);
  f.host.fail=true;await f.tools.toggleFullscreen();
  assert.deepEqual(f.p.notices,[{message:'[en]暂时无法切换全屏，请检查浏览器权限后重试。',kind:'error'}]);
  assert.equal(f.tools.getSnapshot().fullscreen,false);
  const missing=new LocalFrameTools(f.host,f.p.value,{stage:()=>null,video:()=>null,stem:()=>'x'});
  await missing.toggleFullscreen();assert.equal(f.p.notices.length,2);missing.dispose();f.tools.dispose();
});

test('卸载注销监听与账号清理，并在本画框仍全屏时退出',async()=>{
  const scope=new SessionScope(createAppQueryClient(),createPinia()),f=fixture(scope);
  assert.equal(f.host.listenerCount,3);
  await f.tools.toggleFullscreen();assert.equal(f.tools.getSnapshot().fullscreen,true);
  f.tools.dispose();f.tools.dispose();
  assert.equal(f.host.listenerCount,0);assert.equal(f.host.exits,1);
  f.host.emitHidden(true);await tick();assert.equal(f.p.notices.length,0);
  await scope.changeIdentity('new-user');scope.client.clear();
});
