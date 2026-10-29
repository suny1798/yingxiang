<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { loadLookFiles,selectedLookIds } from '../../lib/garment-library';
import { useAccountView } from '../use-account';
import { useGarmentMedia } from '../use-garment-media';
import { useTryOnSession } from '../use-try-on-session';
import { sessionScope } from '../runtime';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import type { View } from '../../lib/try-on/types';
import { DURATION_OPTIONS,durationLabel } from '../../lib/studio/policy';
import { t } from '../preferences';
import GarmentPicker from '../GarmentPicker.vue';
import PreviewPanel from '../PreviewPanel.vue';
import StudioModes from '../StudioModes.vue';
import StudioIcon from '../StudioIcon.vue';
import s from '../../components/studio/studio.module.css';
const {controller,snapshot,camera,stream,preview,previewState,remote,remoteStream,unavailable}=useTryOnSession();
const {input,snapshot:garment}=useGarmentMedia(value=>controller.setGarment(value));
const {snapshot:accountSnapshot,refresh}=useAccountView();
const route=useRoute(),router=useRouter(),importing=ref(false),importError=ref('');
let importAbort:AbortController|undefined;
async function importLooks(){
  importAbort?.abort();
  const ids=selectedLookIds(route.query.looks);
  if(!ids.length){importError.value=route.query.looks?'衣装编号无效，请返回衣装灵感重新选择。':'';return;}
  const current=new AbortController();importAbort=current;importing.value=true;importError.value='';
  try{
    await refresh();
    const files=await loadLookFiles(ids,current.signal);
    if(current.signal.aborted||document.hidden||sessionScope.state.transitioning||sessionScope.state.blocked)return;
    await input.uploadMany(files);
    if(current.signal.aborted)return;
    if(!garment.value.error){const query={...route.query};delete query.looks;await router.replace({path:route.path,query});}
  }catch{if(!current.signal.aborted)importError.value='衣装图片加载失败，请重试或返回衣装灵感重新选择。';}
  finally{if(importAbort===current)importing.value=false;}
}
function cancelImport(){importAbort?.abort();input.cancel();if(importing.value)importError.value='衣装导入已暂停，可点击重试。';importing.value=false;}
let importOwner=sessionScope.capture().userId;
const stopImportIdentity=sessionScope.onIdentityChange(()=>{if(importOwner&&importing.value)cancelImport();importOwner=sessionScope.capture().userId;});
function importHidden(){if(document.hidden)cancelImport();}
onMounted(()=>{document.addEventListener('visibilitychange',importHidden);if(route.query.looks)void importLooks();});
onUnmounted(()=>{cancelImport();stopImportIdentity();document.removeEventListener('visibilitychange',importHidden);});
const account=computed(()=>accountSnapshot.value.account);
const slot=ref<HTMLDivElement|null>(null),picker=ref<{open:()=>void}|null>(null),checking=ref(false),view=ref<View>('original');
const active=computed(()=>['requestingCamera','creatingSession','connecting','live','updatingGarment'].includes(snapshot.value.phase));
const remaining=computed(()=>account.value?.durations.find(item=>item.seconds===snapshot.value.durationSec)?.remaining??0);
const exhausted=computed(()=>Boolean(account.value?.user)&&remaining.value<1);
let stopLayout:(()=>void)|undefined;
onMounted(()=>{stopLayout=mountPreviewSurface(slot.value);});onUnmounted(()=>stopLayout?.());
watch(()=>snapshot.value.phase,phase=>{if(phase==='ended')view.value='original';});
async function start(){
  if(checking.value||garment.value.processing||unavailable.value||!snapshot.value.garment?.blob||!snapshot.value.consent||previewState.value.phase!=='ready'||view.value!=='generated')return;
  checking.value=true;
  try{
    const current=await refresh();
    if(!current||document.hidden)return;
    if(!current.user){sessionScope.state.loginOpen=true;return;}
    if(!current.durations.some(item=>item.seconds===snapshot.value.durationSec&&item.remaining>0))return;
    if(camera.isReady())void controller.start();
  }finally{checking.value=false;}
}
function closeCamera(){controller.stop('相机已关闭。');preview.stop();view.value='original';}
function cameraToggle(){if(stream.value||previewState.value.phase==='requesting')closeCamera();else void preview.start();}
function upload(files:File[]){cancelImport();importError.value='';if(!document.hidden&&!sessionScope.state.transitioning&&!sessionScope.state.blocked)void input.uploadMany(files);}
function selectView(next:View){view.value=next;controller.setView(next);}
</script>
<template>
  <main id="creative-space" :class="[s['page-shell'],s['creation-shell']]" @dragover.prevent @drop.prevent>
    <div :class="s['workbench-title']"><h1>{{t('创作空间')}}</h1><span>{{t('实时换装')}}</span><RouterLink to="/account">{{t(account?.user?`剩余 ${account.durations.reduce((sum,item)=>sum+item.remaining,0)} 次`:'我的权益')}} ↗</RouterLink></div>
    <StudioModes active="realtime"/>
    <div :class="s.workspace">
      <div class="library-picker"><RouterLink to="/wardrobe" class="library-entry"><StudioIcon name="hanger"/><span>{{t('从衣装灵感选图')}}</span><span aria-hidden="true">↗</span></RouterLink><p v-if="importing" role="status" class="library-import">{{t('正在装入所选衣装…')}} <button type="button" @click="cancelImport">{{t('取消')}}</button></p><p v-if="importError" role="alert" class="library-import">{{t(importError)}} <button type="button" @click="importLooks">{{t('重试')}}</button></p><GarmentPicker ref="picker" :input="garment" @upload="upload" @select="input.select" @remove="input.remove" @cancel="cancelImport">
        <template #settings><div :class="[s['duration-bar'],s['duration-settings']]">
          <span>{{t('本次时长')}}</span>
          <div role="group" :aria-label="t('每次换装时长')"><button v-for="seconds in DURATION_OPTIONS" :key="seconds" type="button" :disabled="active||checking" :aria-pressed="snapshot.durationSec===seconds" @click="controller.setDuration(seconds)">{{t(durationLabel(seconds))}}</button></div>
          <span :class="s['duration-note']">{{t(active?snapshot.deadlineAt===null?'连接中 · 出画后计时':'出画后计时 · 换衣不续时':snapshot.durationSec===15?'免费体验':account?.user&&remaining>0?`可用${remaining}次`:'需对应权益')}}</span>
        </div></template>
      </GarmentPicker></div>
      <div ref="slot" :class="s['preview-slot']">
        <PreviewPanel :owner="account?.user?.id??null" :snapshot="snapshot" :view="view" :camera="camera" :stream="stream" :preview-state="previewState" :remote="remote" :remote-stream="remoteStream" :unavailable="unavailable" :processing="garment.processing" :checking="checking" :logged-in="Boolean(account?.user)" :exhausted="exhausted" :remaining="remaining"
          @start="start" @stop="controller.stop()" @camera-toggle="cameraToggle" @view="selectView" @consent="value=>controller.setConsent(value)" @choose="picker?.open()"/>
      </div>
    </div>
    <footer :class="s['creation-footer']"><span/><RouterLink to="/privacy#realtime" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink></footer>
  </main>
</template>
