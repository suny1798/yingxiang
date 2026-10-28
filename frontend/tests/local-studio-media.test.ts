import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { LocalStudioMedia } from '../src/vue/local-studio-media';
import { SessionScope,createAppQueryClient } from '../src/vue/session-scope';
import { LocalCamera } from '../src/lib/media/local-camera';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const scope=()=>new SessionScope(createAppQueryClient(),createPinia());
function stream(){class Track extends EventTarget{readyState='live';stops=0;stop(){this.readyState='ended';this.stops++;}}const track=new Track();return {track,value:{getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]} as unknown as MediaStream};}
const file=()=>new File(['synthetic'],'synthetic.png',{type:'image/png'});

test('访客登录保留本机素材与预览，已认证身份或角色变化清空并停轨',async()=>{
  const s=scope(),m=stream(),revoked:string[]=[];
  const media=new LocalStudioMedia(s,new LocalCamera(async()=>m.value),{prepare:async()=>new Blob(),createURL:()=>'blob:synthetic',revokeURL:url=>{revoked.push(url);},id:()=>'synthetic'});
  await media.input.upload(file());const starting=media.startCamera();await tick();media.camera.markPlaying(m.value);await starting;
  await s.changeIdentity(null,true);await s.changeIdentity('synthetic-user');
  assert.equal(media.input.getSnapshot().garments.length,1);assert.equal(media.camera.isReady(),true);assert.equal(m.track.stops,0);
  await s.changeIdentity('synthetic-user',true);
  assert.equal(media.input.getSnapshot().garments.length,0);assert.equal(media.camera.getSnapshot(),null);assert.equal(m.track.stops,1);assert.deepEqual(revoked,['blob:synthetic']);
  media.dispose();media.dispose();assert.deepEqual(revoked,['blob:synthetic']);s.client.clear();
});

test('隐藏取消相机授权和图片解码，迟到结果不得重新创建流或URL',async()=>{
  const s=scope(),m=stream();let resolveStream!:(value:MediaStream)=>void,resolveImage!:(value:Blob)=>void,urls=0;
  const camera=new LocalCamera(()=>new Promise<MediaStream>(resolve=>{resolveStream=resolve;}));
  const media=new LocalStudioMedia(s,camera,{prepare:()=>new Promise<Blob>(resolve=>{resolveImage=resolve;}),createURL:()=>{urls++;return 'blob:synthetic';},revokeURL(){},id:()=>'synthetic'});
  const starting=media.startCamera(),upload=media.input.upload(file());media.hidden();resolveStream(m.value);resolveImage(new Blob());await Promise.all([starting,upload]);
  assert.equal(m.track.stops,1);assert.equal(media.camera.getSnapshot(),null);assert.equal(media.preview.getSnapshot().phase,'off');assert.equal(media.input.getSnapshot().garments.length,0);assert.equal(urls,0);media.dispose();s.client.clear();
});

test('身份过渡、后台或卸载后不再申请相机，卸载终止已拥有资源',async()=>{
  const s=scope(),m=stream();let calls=0;
  const media=new LocalStudioMedia(s,new LocalCamera(async()=>{calls++;return m.value;}));
  s.state.transitioning=true;await media.startCamera();s.state.transitioning=false;await media.startCamera(true);assert.equal(calls,0);
  const starting=media.startCamera();await tick();media.camera.markPlaying(m.value);await starting;media.dispose();await media.startCamera();await s.changeIdentity('new-user');assert.equal(calls,1);assert.equal(m.track.stops,1);s.client.clear();
});
