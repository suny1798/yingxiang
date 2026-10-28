<script setup lang="ts">
import { ref,computed,onMounted,onUnmounted } from 'vue';
import { useLocalStudio } from '../use-local-studio';
import { useAccountView } from '../use-account';
import { useFrameTools } from '../use-frame-tools';
import { sessionScope } from '../runtime';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import { durationLabel,DURATION_OPTIONS,type DurationSec } from '../../lib/studio/policy';
import { t } from '../preferences';
import GarmentPicker from '../GarmentPicker.vue';
import CameraPreview from '../CameraPreview.vue';
import MediaTools from '../MediaTools.vue';
import MirrorButton from '../MirrorButton.vue';
import StudioModes from '../StudioModes.vue';
import StudioIcon from '../StudioIcon.vue';
import s from '../../components/studio/studio.module.css';
const {media,stream,preview,input,toggleCamera}=useLocalStudio(),{snapshot}=useAccountView();
const slot=ref<HTMLDivElement|null>(null),stage=ref<HTMLElement|null>(null),cameraView=ref<{video:HTMLVideoElement|null}|null>(null),hintClosed=ref(false),duration=ref<DurationSec>(15);
const {snapshot:frame,toggleMirror,toggleFullscreen,capture}=useFrameTools({stage:()=>stage.value,video:()=>cameraView.value?.video??null,stem:()=> '映想-相机原画'});
const status=computed(()=>preview.value.phase==='requesting'?'等待相机':preview.value.phase==='ready'?'相机已开启':'相机未开启');
let stopLayout:(()=>void)|undefined;
onMounted(()=>{stopLayout=mountPreviewSurface(slot.value);});onUnmounted(()=>stopLayout?.());
function upload(files:File[]){if(!document.hidden&&!sessionScope.state.transitioning&&!sessionScope.state.blocked)void media.input.uploadMany(files);}
</script>
<template>
  <main id="creative-space" :class="[s['page-shell'],s['creation-shell']]" @dragover.prevent @drop.prevent>
    <div :class="s['workbench-title']"><h1>{{t('创作空间')}}</h1><span>{{t('实时换装')}}</span><RouterLink to="/account">{{t(snapshot.account?.user?`剩余 ${snapshot.account.durations.reduce((sum,item)=>sum+item.remaining,0)} 次`:'我的权益')}} ↗</RouterLink></div>
    <StudioModes active="realtime"/>
    <div :class="s.workspace">
      <GarmentPicker :input="input" @upload="upload" @select="media.input.select" @remove="media.input.remove" @cancel="media.input.cancel"/>
      <div ref="slot" :class="s['preview-slot']"><section id="preview" data-workspace-preview :class="[s['mirror-panel'],s.panel,s['compact-mirror']]" :aria-label="t('相机与映想画面')">
        <div data-preview-heading :class="s['mirror-heading']"><h2>{{t('画面')}}</h2><span :class="s['session-status']" role="status"><span :class="[s['status-dot'],{[s.neutral]:!stream}]"/>{{t(status)}}</span></div>
        <div data-preview-toolbar :class="s['duration-bar']"><span>{{t('本次时长')}}</span><div role="group" :aria-label="t('每次换装时长')"><button v-for="seconds in DURATION_OPTIONS" :key="seconds" type="button" :aria-pressed="duration===seconds" @click="duration=seconds">{{t(durationLabel(seconds))}}</button></div><span :class="s['duration-note']">{{t('本地预览 · 不上传')}}</span></div>
        <div data-preview-viewport :class="s['preview-viewport']"><div ref="stage" data-preview-stage :class="[s['mirror-stage'],s['preview-frame']]" :data-state="preview.phase">
          <CameraPreview v-if="stream" ref="cameraView" :stream="stream" :camera="media.camera" :mirrored="frame.mirrored"/>
          <div v-else :class="s['camera-empty']"><video :class="s['demo-video']" autoplay muted loop playsinline preload="auto" poster="/assets/try-on-demo-poster.jpg" aria-hidden="true"><source src="/assets/try-on-demo.webm" type="video/webm"/><source src="/assets/try-on-demo.mp4" type="video/mp4"/></video><img :class="s['demo-poster']" src="/assets/try-on-demo-poster.jpg" alt="" aria-hidden="true"/>
            <div v-if="!hintClosed" :class="s['demo-prompt']"><button type="button" :class="s['hint-close']" :aria-label="t('关闭相机使用提示')" @click="hintClosed=true"><StudioIcon name="close"/></button><p><strong>{{t(preview.phase==='requesting'?'等待相机授权…':'打开相机后选择服装')}}</strong><span>{{t('上方为示意动画，不是实际生成效果')}}</span></p><button type="button" :class="s['primary-button']" :disabled="preview.phase==='requesting'||sessionScope.state.transitioning||sessionScope.state.blocked" @click="toggleCamera"><StudioIcon name="camera"/>{{t(preview.phase==='requesting'?'等待授权':'打开相机')}}</button></div>
          </div>
          <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!stream||preview.phase!=='ready'" @fullscreen="toggleFullscreen" @capture="capture"/>
          <div :class="s['preview-badges']"><span>{{t('本地预览 · 不上传')}}</span></div>
        </div></div>
        <div data-preview-controls :class="s['preview-controls']"><div :class="s['view-switch']" role="group" :aria-label="t('画面切换')"><button type="button" aria-pressed="true" :class="s.selected">{{t('相机原画')}}</button><button type="button" disabled :title="t('换装服务暂未就绪')">{{t('映想画面 ')}}<span aria-hidden="true">✳</span></button></div><div :class="s['preview-actions']"><MirrorButton :mirrored="frame.mirrored" :disabled="false" @toggle="toggleMirror"/><button type="button" :class="s['camera-button']" :aria-pressed="!!stream||preview.phase==='requesting'" :disabled="!stream&&preview.phase!=='requesting'&&(sessionScope.state.transitioning||sessionScope.state.blocked)" @click="toggleCamera"><StudioIcon name="camera"/>{{t(preview.phase==='requesting'?'取消打开':stream?'关闭相机':'打开相机')}}</button></div></div>
        <div data-preview-details :class="s['recording-bar']"><span :class="s['record-hint']">{{t('本地预览不上传 · 不采集音频')}}</span><span role="status">{{t('换装服务暂未就绪')}}</span></div>
        <p v-if="preview.message" :class="s['camera-error']" role="alert">{{t(preview.message)}}</p>
      </section></div>
    </div>
    <footer :class="s['creation-footer']"><span/><RouterLink to="/privacy#realtime" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink></footer>
  </main>
</template>
