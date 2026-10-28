import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { LocalVideoFile,LocalVideoMedia,type LocalVideoPlatform } from '../src/vue/local-video-studio';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import { VIDEO_POLICY } from '../src/lib/video/policy';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const file=(name='person.mp4',size=1024)=>new File([new Uint8Array(size)],name,{type:'video/mp4'});

function platform(){
  const reads:File[]=[],urls:string[]=[],revoked:string[]=[],notices:Array<{message:string;kind:string}>=[];
  const queue:Array<{resolve:(bytes:Uint8Array)=>void;reject:(error:unknown)=>void}>=[];
  const value:LocalVideoPlatform={
    read:(input)=>{reads.push(input);return new Promise<Uint8Array>((resolve,reject)=>{queue.push({resolve,reject});});},
    inspect:()=>({seconds:7.5,hasAudio:true}),
    createURL:(input)=>{const url=`blob:${input.name}:${urls.length+1}`;urls.push(url);return url;},
    revokeURL:(url)=>{revoked.push(url);},
    notify:(message,kind)=>{notices.push({message,kind});},
    translate:(message)=>`[en]${message}`,
  };
  return {value,reads,urls,revoked,notices,resolve:(bytes=new Uint8Array([1]))=>queue.shift()!.resolve(bytes),reject:(error:unknown)=>queue.shift()!.reject(error)};
}
const scope=()=>new SessionScope(createAppQueryClient(),createPinia());
const images=()=>({prepare:async()=>new Blob(),createURL:()=>`blob:image`,revokeURL:()=>{},id:()=>'synthetic'});

test('有效视频只读一次，按原时长与音轨信息就绪并给出本机静音说明',async()=>{
  const p=platform(),video=new LocalVideoFile(p.value),running=video.choose(file());
  assert.equal(video.getSnapshot().validating,true);assert.equal(p.reads.length,1);
  p.resolve();await running;
  const snapshot=video.getSnapshot();
  assert.equal(snapshot.file?.name,'person.mp4');assert.equal(snapshot.url,'blob:person.mp4:1');assert.equal(snapshot.seconds,7.5);assert.equal(snapshot.hasAudio,true);assert.equal(snapshot.validating,false);assert.equal(snapshot.error,null);
  assert.deepEqual(p.notices,[{message:'[en]视频已准备好。',kind:'success'},{message:'[en]检测到音轨；本机预览为静音，云端提交时会自动移除。',kind:'info'}]);
  video.dispose();assert.deepEqual(p.revoked,['blob:person.mp4:1']);
});

test('大小或扩展名不合格时不读取文件，错误同时进入页面与通知',async()=>{
  const p=platform(),video=new LocalVideoFile(p.value);
  await video.choose({name:'huge.mp4',size:VIDEO_POLICY.maxBytes+1} as File);
  assert.equal(p.reads.length,0);assert.equal(video.getSnapshot().error,'请选择不超过25MB的MP4视频。');
  await video.choose(file('person.mov'));
  assert.equal(p.reads.length,0);assert.equal(p.notices.length,2);assert.equal(p.notices[1].kind,'error');
  video.dispose();
});

test('格式校验失败保留原视频且不创建URL',async()=>{
  const p=platform(),video=new LocalVideoFile(p.value),first=video.choose(file());p.resolve();await first;
  const failing={...p.value,inspect:()=>{throw new Error('视频格式无法验证，请导出为普通H.264 MP4后再试。');}};
  const next=new LocalVideoFile(failing),running=next.choose(file('other.mp4'));p.resolve();await running;
  assert.equal(next.getSnapshot().url,null);assert.equal(next.getSnapshot().file,null);assert.equal(next.getSnapshot().error,'视频格式无法验证，请导出为普通H.264 MP4后再试。');
  assert.equal(video.getSnapshot().url,'blob:person.mp4:1');video.dispose();next.dispose();
});

test('替换视频先撤销旧URL；迟到或取消的读取不创建URL也不通知',async()=>{
  const p=platform(),video=new LocalVideoFile(p.value),first=video.choose(file('a.mp4'));p.resolve();await first;
  const second=video.choose(file('b.mp4'));p.resolve();await second;
  assert.deepEqual(p.revoked,['blob:a.mp4:1']);assert.equal(video.getSnapshot().url,'blob:b.mp4:2');
  const late=video.choose(file('c.mp4'));video.cancel();p.resolve();await late;
  assert.equal(video.getSnapshot().url,'blob:b.mp4:2');assert.equal(video.getSnapshot().validating,false);
  assert.equal(p.urls.length,2);
  const replaced=video.choose(file('d.mp4')),superseded=video.choose(file('e.mp4'));p.resolve();await replaced;
  assert.equal(video.getSnapshot().url,'blob:b.mp4:2');p.resolve();await superseded;assert.equal(video.getSnapshot().url,'blob:e.mp4:3');
  video.dispose();
});

test('隐藏只停止校验，已就绪视频保留；移除后清空并释放URL',async()=>{
  const p=platform(),video=new LocalVideoFile(p.value),first=video.choose(file());p.resolve();await first;
  const running=video.choose(file('next.mp4'));video.cancel();p.resolve();await running;
  assert.equal(video.getSnapshot().url,'blob:person.mp4:1');assert.equal(video.getSnapshot().validating,false);
  video.remove();assert.deepEqual(video.getSnapshot(),{file:null,url:null,seconds:null,hasAudio:false,validating:false,error:null});
  assert.deepEqual(p.revoked,['blob:person.mp4:1']);video.dispose();assert.deepEqual(p.revoked,['blob:person.mp4:1']);
});

test('已认证身份变化清空视频与参考图，访客登录保留本机素材',async()=>{
  const s=scope(),p=platform(),guest=new LocalVideoMedia(s,p.value,images());
  const guestVideo=guest.video.choose(file());p.resolve();await guestVideo;await guest.input.upload(file('garment.png',8));
  await s.changeIdentity('user-1');
  assert.equal(guest.video.getSnapshot().url,'blob:person.mp4:1');assert.equal(guest.input.getSnapshot().garments.length,1);
  const member=new LocalVideoMedia(s,p.value,images());
  const memberVideo=member.video.choose(file());p.resolve();await memberVideo;await member.input.upload(file('garment.png',8));
  await s.changeIdentity('user-2',true);
  assert.equal(member.video.getSnapshot().url,null);assert.equal(member.input.getSnapshot().garments.length,0);assert.ok(p.revoked.includes('blob:person.mp4:1'));
  member.dispose();guest.dispose();s.client.clear();
});

test('卸载后迟到读取不创建URL，重复卸载不重复释放',async()=>{
  const s=scope(),p=platform(),media=new LocalVideoMedia(s,p.value,images()),running=media.video.choose(file());
  media.dispose();media.dispose();p.resolve();await running;await tick();
  assert.equal(p.urls.length,0);assert.equal(p.revoked.length,0);assert.equal(p.notices.length,0);
  s.client.clear();
});
