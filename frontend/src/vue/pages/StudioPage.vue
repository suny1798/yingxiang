<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { useAccountView } from '../use-account';
import { useGarmentMedia } from '../use-garment-media';
import { useTryOnSession } from '../use-try-on-session';
import { sessionScope } from '../runtime';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import type { View } from '../../lib/try-on/types';
import { t } from '../preferences';
import GarmentPicker from '../GarmentPicker.vue';
import PreviewPanel from '../PreviewPanel.vue';
import StudioModes from '../StudioModes.vue';
import s from '../../components/studio/studio.module.css';
const {controller,snapshot,camera,stream,preview,previewState,remote,remoteStream,unavailable}=useTryOnSession();
const {input,snapshot:garment}=useGarmentMedia(value=>controller.setGarment(value));
const {snapshot:accountSnapshot,refresh}=useAccountView();
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
function upload(files:File[]){if(!document.hidden&&!sessionScope.state.transitioning&&!sessionScope.state.blocked)void input.uploadMany(files);}
function selectView(next:View){view.value=next;controller.setView(next);}
</script>
<template>
  <main id="creative-space" :class="[s['page-shell'],s['creation-shell']]" @dragover.prevent @drop.prevent>
    <div :class="s['workbench-title']"><h1>{{t('创作空间')}}</h1><span>{{t('实时换装')}}</span><RouterLink to="/account">{{t(account?.user?`剩余 ${account.durations.reduce((sum,item)=>sum+item.remaining,0)} 次`:'我的权益')}} ↗</RouterLink></div>
    <StudioModes active="realtime"/>
    <div :class="s.workspace">
      <GarmentPicker ref="picker" :input="garment" @upload="upload" @select="input.select" @remove="input.remove" @cancel="input.cancel"/>
      <div ref="slot" :class="s['preview-slot']">
        <PreviewPanel :owner="account?.user?.id??null" :snapshot="snapshot" :view="view" :camera="camera" :stream="stream" :preview-state="previewState" :remote="remote" :remote-stream="remoteStream" :unavailable="unavailable" :processing="garment.processing" :checking="checking" :logged-in="Boolean(account?.user)" :exhausted="exhausted" :remaining="remaining"
          @start="start" @stop="controller.stop()" @camera-toggle="cameraToggle" @view="selectView" @duration="value=>controller.setDuration(value)" @consent="value=>controller.setConsent(value)" @choose="picker?.open()"/>
      </div>
    </div>
    <footer :class="s['creation-footer']"><span/><RouterLink to="/privacy#realtime" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink></footer>
  </main>
</template>
