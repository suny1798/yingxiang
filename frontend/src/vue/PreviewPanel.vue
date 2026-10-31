<script setup lang="ts">
import PreviewControls from './PreviewControls.vue';
import WorkspacePreview from './WorkspacePreview.vue';
import { computed,ref,watch } from 'vue';
import type { CameraPreviewState } from '../lib/media/camera-preview-session';
import type { LocalCamera } from '../lib/media/local-camera';
import type { RemotePreview } from '../lib/media/remote-preview';
import { ACTIVE_PHASES,type SessionSnapshot,type View } from '../lib/try-on/types';
import { durationLabel } from '../lib/studio/policy';
import { notices,notify } from '../lib/notices';
import { useFrameTools } from './use-frame-tools';
import { useGeneratedRecording } from './use-generated-recording';
import { useOrientedDownload } from './use-oriented-download';
import { t } from './preferences';
import CameraPreview from './CameraPreview.vue';
import MediaTools from './MediaTools.vue';
import MirrorButton from './MirrorButton.vue';
import StudioIcon from './StudioIcon.vue';
import base from '../components/studio/studio.module.css';
const props=defineProps<{owner:string|null;snapshot:SessionSnapshot;view:View;camera:LocalCamera;stream:MediaStream|null;previewState:CameraPreviewState;remote:RemotePreview;remoteStream:MediaStream|null;unavailable:string|null;processing:boolean;checking:boolean;loggedIn:boolean;exhausted:boolean;remaining:number;testAccess?:boolean}>();
const emit=defineEmits<{start:[];stop:[];cameraToggle:[];view:[View];consent:[boolean];choose:[]}>();
const stage=ref<HTMLElement|null>(null),localPreview=ref<{video:HTMLVideoElement|null}|null>(null),remotePreview=ref<{video:HTMLVideoElement|null}|null>(null),replayVideo=ref<HTMLVideoElement|null>(null);
const replay=ref(false),originalHintDismissed=ref(false),setupDismissed=ref(false),replayReady=ref(false);
const active=computed(()=>ACTIVE_PHASES.has(props.snapshot.phase)),live=computed(()=>props.snapshot.phase==='live'||props.snapshot.phase==='updatingGarment');
const generated=computed(()=>props.view==='generated'),showRemote=computed(()=>generated.value&&live.value&&Boolean(props.remoteStream)),showReplay=computed(()=>!active.value&&replay.value&&Boolean(recording.value.url));
const cameraReady=computed(()=>props.previewState.phase==='ready'),requesting=computed(()=>props.previewState.phase==='requesting');
const captureAvailable=computed(()=>showReplay.value?replayReady.value:showRemote.value||(cameraReady.value&&Boolean(props.stream)));
const {snapshot:frame,toggleMirror,toggleFullscreen,capture}=useFrameTools({stage:()=>stage.value,video:()=>showReplay.value?replayVideo.value:showRemote.value?(remotePreview.value?.video??null):(localPreview.value?.video??null),stem:()=>showReplay.value?'映想-实时换装回放':showRemote.value?'映想-AI换装':'映想-相机原画'});
const {recording,save,clearRecording}=useGeneratedRecording({enabled:true,live:()=>live.value,stream:()=>props.remoteStream,session:()=>props.snapshot.deadlineAt,seconds:()=>props.snapshot.durationSec,owner:()=>props.owner,reference:()=>props.snapshot.garment});
const {busy:downloadBusy,download,cancel:cancelDownload}=useOrientedDownload(()=>recording.value.url,()=>'映想-实时换装',()=>props.owner);
const validImage=computed(()=>Boolean(props.snapshot.garment?.blob)),time=computed(()=>`${String(Math.floor(props.snapshot.remainingSeconds/60)).padStart(2,'0')}:${String(props.snapshot.remainingSeconds%60).padStart(2,'0')}`);
const cloudReady=computed(()=>cameraReady.value&&validImage.value&&!props.processing&&!props.unavailable&&!props.exhausted);
const status=computed(()=>active.value?live.value?'换装中':'连接中':requesting.value?'等待相机':cameraReady.value?'相机已开启':'相机未开启');
const viewHint=computed(()=>Boolean(props.stream)&&cameraReady.value&&!generated.value&&!active.value);
watch(active,value=>{if(value)replay.value=false;});
watch(()=>recording.value.phase,phase=>{if(phase==='ready')replay.value=true;});
watch(()=>recording.value.url,()=>{replayReady.value=false;});
watch(()=>props.previewState.message,message=>{if(message)notify(message,'error');});
watch(()=>recording.value.message,message=>{if(message)notify(message,'error');});
watch(()=>save.value.phase,phase=>{if(phase==='error')notify(save.value.message??'保存未完成，请查看我的作品','error');if(phase==='saved')notify(save.value.message??'视频与服装参考图已保存到我的作品。',save.value.message?'info':'success');});
function selectView(next:View){replay.value=false;if(next==='original')originalHintDismissed.value=false;else setupDismissed.value=false;emit('view',next);}
function toggleReplay(){replay.value=!replay.value;}
function clearReplay(){replay.value=false;clearRecording();}
function onReplayLoaded(){replayReady.value=true;}
function onReplayError(){replayReady.value=false;}
function onConsent(event:Event){emit('consent',(event.target as HTMLInputElement).checked);}
function onDownload(){if(downloadBusy.value)cancelDownload();else download(frame.value.mirrored);}
</script>
<template>
  <WorkspacePreview id="preview" :class="[base['mirror-panel'],base.panel,base['compact-mirror']]" :aria-label="t('相机与映想画面')">
    <div data-preview-heading :class="base['mirror-heading']"><h2>{{t('画面')}}</h2><span :class="base['session-status']" role="status"><span :class="[base['status-dot'],{[base.neutral]:!stream}]"/>{{t(status)}}</span></div>
    <div data-preview-viewport :class="base['preview-viewport']"><div ref="stage" data-preview-stage :class="[base['mirror-stage'],base['preview-frame']]" :data-state="snapshot.phase">
      <CameraPreview v-if="stream" ref="localPreview" :stream="stream" :camera="camera" :visible="!showRemote&&!showReplay" :mirrored="frame.mirrored"/>
      <div v-else :class="base['camera-empty']"><video :class="base['demo-video']" autoplay muted loop playsinline preload="auto" poster="/assets/try-on-demo-poster.jpg" aria-hidden="true"><source src="/assets/try-on-demo.webm" type="video/webm"/><source src="/assets/try-on-demo.mp4" type="video/mp4"/></video><img :class="base['demo-poster']" src="/assets/try-on-demo-poster.jpg" alt="" aria-hidden="true"/>
        <div v-if="!generated&&!showReplay&&!originalHintDismissed" :class="base['demo-prompt']"><button type="button" :class="base['hint-close']" :aria-label="t('关闭相机使用提示')" @click="originalHintDismissed=true"><StudioIcon name="close"/></button><p><strong>{{t(requesting?'等待相机授权…':'打开相机后选择服装')}}</strong><span>{{t('上方为示意动画，不是实际生成效果')}}</span></p><button type="button" :class="base['primary-button']" :disabled="requesting" @click="emit('cameraToggle')"><StudioIcon name="camera"/>{{t(requesting?'等待授权':'打开相机')}}</button></div>
      </div>
      <video v-if="showReplay" ref="replayVideo" :data-mirrored="frame.mirrored" :class="base['camera-video']" :src="recording.url ?? undefined" controls playsinline :aria-label="t('本次换装视频回放')" @loadeddata="onReplayLoaded" @error="onReplayError"/>
      <div v-if="viewHint&&!showReplay&&!originalHintDismissed" :class="base['demo-prompt']"><button type="button" :class="base['hint-close']" :aria-label="t('关闭相机使用提示')" @click="originalHintDismissed=true"><StudioIcon name="close"/></button><p><strong>{{t('相机已开启，切到映想画面')}}</strong><span>{{t(validImage?'服装已选好，在映想画面确认后开始换装':'在映想画面选一件服装，开始换装')}}</span></p><button type="button" :class="base['primary-button']" @click="selectView('generated')"><span aria-hidden="true">✳</span>{{t('切到映想画面')}}</button></div>
      <CameraPreview v-if="remoteStream" ref="remotePreview" :stream="remoteStream" :camera="remote" :visible="showRemote" remote :mirrored="frame.mirrored"/>
      <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!captureAvailable" @fullscreen="toggleFullscreen" @capture="capture"/>
      <div :class="base['preview-badges']"><span>{{t(showReplay?'本次换装回放':showRemote?'AI 生成':stream?'相机原画':'本地相机')}}</span><span v-if="active&&snapshot.deadlineAt!==null" :class="base.timer" :aria-label="t('换装剩余时间')">{{t(time)}}</span></div>
      <div v-if="generated&&!showRemote&&!showReplay&&(active||!setupDismissed)" :class="[base['floating-card'],active?base['floating-connecting']:!cameraReady||!validImage?base['floating-quick']:'']" :aria-label="t(active?'正在连接换装':'开启映想换装')">
        <button v-if="!active" type="button" :class="base['hint-close']" :aria-label="t('关闭换装操作提示')" @click="setupDismissed=true"><StudioIcon name="close"/></button>
        <span :class="base['imagine-orbit']" aria-hidden="true">✳</span>
        <template v-if="active"><h3>{{t('正在连接映想…')}}</h3><span :class="base['connection-sweep']" aria-hidden="true"/><button type="button" :class="base['text-button']" @click="emit('stop')">{{t('取消连接')}}</button></template>
        <template v-else-if="!cameraReady"><h3>{{t(requesting?'相机准备中…':'先打开相机')}}</h3><button type="button" :class="base['primary-button']" :disabled="requesting" @click="emit('cameraToggle')"><StudioIcon name="camera"/>{{t(requesting?'等待授权':'打开相机')}}</button></template>
        <template v-else-if="!validImage"><h3>{{t('请选择服装参考图')}}</h3><button type="button" :class="base['primary-button']" :disabled="processing" @click="emit('choose')"><StudioIcon name="upload"/>{{t(processing?'处理中…':'选择服装')}}</button></template>
        <template v-else-if="exhausted"><h3>{{t(snapshot.phase==='error'?'本次连接已停止':snapshot.durationSec===15?'15秒体验次数已用完':`暂无${durationLabel(snapshot.durationSec)}权益`)}}</h3><RouterLink to="/account" :class="base['floating-link']">{{t('查看我的权益 ↗')}}</RouterLink><RouterLink v-if="snapshot.durationSec!==15" to="/pricing" :class="base['text-button']">{{t('查看方案 · 购买暂未开放 ↗')}}</RouterLink></template>
        <template v-else><h3>{{t('确认后开始实时换装')}}</h3><label :class="base['floating-consent']"><input type="checkbox" :checked="snapshot.consent" @change="onConsent"/><span>{{t('已获素材授权，同意云端处理')}}</span></label><button type="button" :class="base['primary-button']" :disabled="!cloudReady||!snapshot.consent||checking" @click="emit('start')"><span aria-hidden="true">✳</span>{{t(checking?'正在验证…':loggedIn?'开始换装':'登录并体验')}}<StudioIcon name="arrow"/></button><div :class="base['floating-meta']"><span>{{t(testAccess?'手动测试 · 不扣积分':snapshot.durationSec===15?'免费 · ':'')}} {{t('最多')}}{{t(durationLabel(snapshot.durationSec))}}{{t(remaining>1?` · 剩余${remaining}次`:'')}}</span><RouterLink to="/privacy#realtime" target="_blank" rel="noopener noreferrer">{{t('隐私说明 ↗')}}</RouterLink></div></template>
        <details v-if="!active&&validImage&&cameraReady&&unavailable&&!exhausted" :class="base['floating-error']"><summary>{{t('换装服务暂未就绪')}}</summary><p>{{t(unavailable)}}</p></details>
        <details v-if="!active&&snapshot.phase==='error'&&snapshot.message" :class="base['floating-error']"><summary>{{t('连接未完成，查看详情')}}</summary><p>{{t(snapshot.message)}}</p></details>
      </div>
    </div></div>
    <PreviewControls :view-label="t('画面切换')">
      <template #views><button type="button" :aria-pressed="!generated" @click="selectView('original')">{{t('相机原画')}}</button><button type="button" :aria-pressed="generated" :data-hint="viewHint && !generated" @click="selectView('generated')">{{t('映想画面 ')}}<span aria-hidden="true">✳</span></button></template>
      <template #info>
        <div data-preview-save :class="base['recording-bar']">
          <RouterLink :class="base['record-toggle']" to="/works"><span><strong>{{t('自动保存 · 我的作品 ↗')}}</strong></span></RouterLink>
          <span role="status">{{t(save.message??(save.phase==='error'?'保存未完成，请查看我的作品':save.phase==='saved'?'已保存到我的作品':recording.phase==='recording'?'正在录制并后台保存…':save.phase==='saving'?'后台保存中…':recording.message??''))}}</span>
          <div v-if="recording.url"><button type="button" :aria-pressed="showReplay" @click="toggleReplay">{{t(showReplay?'返回实时画面':'回放视频')}}</button><button type="button" :class="base['download-button']" @click="onDownload">{{t(downloadBusy?'取消导出':'下载视频 ↓')}}</button><button type="button" @click="clearReplay">{{t('清除回放')}}</button></div>
        </div>
      </template>
      <template #actions><button v-if="active" type="button" data-preview-stop @click="emit('stop')"><span :class="base['stop-square']"/>{{t('结束换装')}}</button><MirrorButton :mirrored="frame.mirrored" :disabled="downloadBusy" @toggle="toggleMirror"/><button type="button" data-preview-primary :aria-pressed="Boolean(stream)||requesting" @click="emit('cameraToggle')"><StudioIcon name="camera"/>{{t(requesting?'取消打开':stream?'关闭相机':'打开相机')}}</button></template>
    </PreviewControls>

    <p v-if="previewState.message" :class="base['camera-error']" role="alert">{{t(previewState.message)}}</p>
  </WorkspacePreview>
</template>
