<script setup lang="ts">
import PreviewControls from '../PreviewControls.vue';
import WorkspacePreview from '../WorkspacePreview.vue';
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { loadLookFiles,selectedLookIds } from '../../lib/garment-library';
import { useLocalVideoStudio } from '../use-local-video-studio';
import { useVideoJobs } from '../use-video-jobs';
import { useAccountView } from '../use-account';
import { useFrameTools } from '../use-frame-tools';
import { useOrientedDownload } from '../use-oriented-download';
import { sessionScope } from '../runtime';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import { VIDEO_POLICY,VIDEO_STATE_LABEL } from '../../lib/video/policy';
import { inProgress } from '../video-jobs';
import { notify } from '../../lib/notices';
import { t } from '../preferences';
import StudioSidebar from '../StudioSidebar.vue';
import { useCredits } from '../use-credits';
import BillingEstimate from '../BillingEstimate.vue';
import StudioIcon from '../StudioIcon.vue';
import MediaTools from '../MediaTools.vue';
import MirrorButton from '../MirrorButton.vue';
import base from '../../components/studio/studio.module.css';
import s from '../../components/studio/video-studio.module.css';
const {media,video,input,selected,choose,uploadImages,remove,cancel}=useLocalVideoStudio();
const {state:jobsState,jobs}=useVideoJobs();
const {snapshot:accountSnapshot,refresh}=useAccountView();
const account=computed(()=>accountSnapshot.value.account),needsLogin=computed(()=>!account.value?.user);
const remainingTrials=computed(()=>account.value?.user&&account.value.videoTrial?.enabled?account.value.videoTrial.remaining:0);
const {credits,failed:creditsFailed}=useCredits(computed(()=>account.value?.user?.id??null));
const service=computed(()=>jobsState.value.service),selectedJob=computed(()=>jobsState.value.selected);
const consent=ref(false),checking=ref(false),showResult=ref(false),resultFailed=ref(false),resultRevision=ref(0),previewReady=ref(false);
const slot=ref<HTMLDivElement|null>(null),stage=ref<HTMLElement|null>(null),mediaElement=ref<HTMLVideoElement|null>(null),fileInput=ref<HTMLInputElement|null>(null),imageInput=ref<HTMLInputElement|null>(null);
const route=useRoute(),router=useRouter(),importing=ref(false),importError=ref('');
let importAbort:AbortController|undefined;
async function importLooks(){
  importAbort?.abort();
  const ids=selectedLookIds(route.query.looks).slice(0,1);
  if(!ids.length){importError.value=route.query.looks?'衣装编号无效，请返回衣装灵感重新选择。':'';return;}
  const current=new AbortController();importAbort=current;importing.value=true;importError.value='';
  try{
    await refresh();
    const files=await loadLookFiles(ids,current.signal);
    if(current.signal.aborted||document.hidden||sessionScope.state.transitioning||sessionScope.state.blocked)return;
    await media.input.replace(files[0]);
    if(current.signal.aborted)return;
    if(!input.value.error){const query={...route.query};delete query.looks;await router.replace({path:route.path,query});}
  }catch{if(!current.signal.aborted)importError.value='衣装图片加载失败，请重试或返回衣装灵感重新选择。';}
  finally{if(importAbort===current)importing.value=false;}
}
function cancelImport(){importAbort?.abort();media.input.cancel();if(importing.value)importError.value='衣装导入已暂停，可点击重试。';importing.value=false;}
function importHidden(){if(document.hidden)cancelImport();}
const resultUrl=computed(()=>{const job=selectedJob.value;return job&&!job.expired&&job.state==='completed'?`/api/video/jobs/${job.id}/content?v=${resultRevision.value}`:null;});
const resultVisible=computed(()=>Boolean(showResult.value&&resultUrl.value&&!resultFailed.value));
const localVisible=computed(()=>Boolean(video.value.url)&&!video.value.validating&&!jobsState.value.preparing&&!(showResult.value&&resultUrl.value));
const resultStem=computed(()=>selectedJob.value?.title?.replace(/[<>:"/\\|?*]/g,'_')||'映想-视频换装');
const processing=computed(()=>Boolean(selectedJob.value&&inProgress(selectedJob.value)));
const status=computed(()=>selectedJob.value?(selectedJob.value.expired?'访问已过期':VIDEO_STATE_LABEL[selectedJob.value.state]):video.value.url?'本地预览':'等待素材');
const jobNotice=computed(()=>{const job=selectedJob.value;if(!job)return null;if(job.expired)return '视频访问窗口已结束。';if(job.state==='unknown')return '提交结果尚未确认，请刷新任务核查，不要再次生成。';if(job.state==='failed')return '视频换装未完成，请检查任务状态后再试。';return null;});
const showJobNotice=computed(()=>Boolean(jobNotice.value&&!processing.value));
const canSubmit=computed(()=>Boolean(video.value.file&&selected.value?.blob&&consent.value&&!trialTooLong.value&&!video.value.validating&&!input.value.processing&&!jobsState.value.submitting&&!jobsState.value.preparing&&!checking.value&&(needsLogin.value||service.value?.available)));
const trialTooLong=computed(()=>Boolean(account.value?.videoTrial?.enabled&&!account.value.videoTrial.unlimited&&(video.value.seconds??0)>10.001));
const submitLabel=computed(()=>jobsState.value.submitting?(jobsState.value.preparing?'正在准备…':'正在提交…'):needsLogin.value?'登录后生成':'生成换装视频');
const preparationLabel=computed(()=>{const progress=jobsState.value.preparation;return progress?.stage==='processing'?'正在自动移除音轨…':progress?.stage==='download'?'正在接收处理结果…':progress?'正在上传视频…':'正在准备你的视频…';});
const {snapshot:frame,toggleMirror,toggleFullscreen,capture}=useFrameTools({stage:()=>stage.value,video:()=>mediaElement.value,stem:()=>resultVisible.value?resultStem.value:'映想-本地人物视频',mirrored:false});
const {busy:downloadBusy,download,cancel:cancelDownload}=useOrientedDownload(()=>resultUrl.value,()=>resultStem.value,()=>account.value?.user?.id??null);
let stopLayout:(()=>void)|undefined;
onMounted(()=>{stopLayout=mountPreviewSurface(slot.value);document.addEventListener('visibilitychange',importHidden);if(route.query.looks)void importLooks();});onUnmounted(()=>{cancelImport();document.removeEventListener('visibilitychange',importHidden);stopLayout?.();cancelDownload();});
watch(()=>video.value.url,()=>{consent.value=false;showResult.value=false;resultFailed.value=false;jobs.resetAttempt();jobs.clearSelected();});
watch(()=>account.value?.user?.id,()=>{consent.value=false;showResult.value=false;resultFailed.value=false;});
watch(selectedJob,(job,previous)=>{
  if(!job){showResult.value=false;return;}
  if(job.id!==previous?.id||job.state!==previous?.state){showResult.value=job.state==='completed';resultFailed.value=false;}
  if(previous&&previous.id===job.id&&previous.state!==job.state){if(job.state==='completed')notify('换装视频已生成，可以预览和下载。','success');if(job.state==='failed')notify('视频换装未完成，请检查任务状态后再试。','error');}
});
watch(()=>service.value&&!service.value.available?service.value.message:null,message=>{if(message)notify(message,'info');});
watch([()=>resultUrl.value,()=>video.value.url,()=>showResult.value,()=>video.value.validating,()=>jobsState.value.preparing],()=>{previewReady.value=false;});
function pickVideo(event:Event){const element=event.target as HTMLInputElement,file=element.files?.[0];element.value='';choose(file);}
function pickImages(event:Event){const element=event.target as HTMLInputElement,files=Array.from(element.files??[]);element.value='';if(files.length){uploadImages(files);consent.value=false;}}
function removeGarment(id:string){media.input.remove(id);consent.value=false;}
function removeVideo(){remove();consent.value=false;showResult.value=false;resultFailed.value=false;jobs.resetAttempt();jobs.clearSelected();}
function cancelPreparation(){jobs.cancelPreparation();}
function returnCreate(){showResult.value=false;resultFailed.value=false;jobs.clearSelected();}
function refreshJobs(){void jobs.refresh();}
function reloadResult(){resultFailed.value=false;resultRevision.value+=1;}
function onLocalLoaded(){previewReady.value=true;}
function onLocalError(){previewReady.value=false;}
function onResultLoaded(){previewReady.value=true;}
function onResultError(){previewReady.value=false;resultFailed.value=true;}
function onDownload(){if(downloadBusy.value)cancelDownload();else download(frame.value.mirrored);}
async function submit(){
  const file=video.value.file,garment=selected.value?.blob,hasAudio=video.value.hasAudio;
  if(checking.value||jobsState.value.submitting||jobsState.value.preparing||!file||!garment||!consent.value||trialTooLong.value||video.value.validating||input.value.processing||document.hidden)return;
  checking.value=true;
  try{
    const current=await refresh();
    if(document.hidden)return;
    if(!current?.user){sessionScope.state.loginOpen=true;return;}
    if(!jobsState.value.service)await jobs.load();
    if(!jobsState.value.service?.available){if(jobsState.value.service?.message)notify(jobsState.value.service.message,'info');return;}
    await jobs.submit({file,garment,hasAudio,consentVersion:VIDEO_POLICY.consentVersion});
  }finally{checking.value=false;}
}
</script>
<template>
  <main id="creative-space" :class="[base['page-shell'],base['creation-shell']]">
    <div :class="base['workbench-title']"><h1>{{t('创作空间')}}</h1><span>{{t('视频换装')}}</span><div v-if="video.seconds||resultVisible" :class="s.headerEstimate"><BillingEstimate scene="video" :seconds="video.seconds" :completed="resultVisible" :result-seconds="selectedJob?.resultSeconds" :result-pending="selectedJob?.resultPending" :billing="selectedJob?.billing" inline/></div><small v-else :class="base['credit-hint']">{{t('1秒=1积分，未用将返还')}}</small><RouterLink to="/account" :class="base['credit-link']">{{t(account?.user?(credits!==null?`剩余 ${credits} 积分`:creditsFailed?'我的权益':'积分读取中…'):'我的权益')}} ↗</RouterLink></div>
    <div :class="base.workspace">
      <StudioSidebar active="video">
      <section :class="s.inputs" data-video-inputs :aria-label="t('视频换装素材')">
        <div :class="s.fieldHeading"><h2>{{t('人物视频')}}</h2><span>{{t('1—30秒')}}<span v-if="remainingTrials>0" :class="s.trialNote"> · {{t(`可试用${remainingTrials}次`)}}</span></span></div>
        <input ref="fileInput" :class="base['visually-hidden']" type="file" accept="video/mp4,.mp4" :aria-label="t('选择人物视频')" tabindex="-1" @change="pickVideo"/>
        <button v-if="!video.file||video.validating" type="button" :class="s.videoUpload" :title="video.file?.name" :disabled="jobsState.submitting||jobsState.preparing" @click="fileInput?.click()"><span v-if="video.file&&!video.validating" :class="s.uploadReady" aria-hidden="true"><StudioIcon name="check"/></span><span v-else aria-hidden="true">▷</span><strong>{{t(video.validating?'正在检查视频…':video.file?'视频已就绪':'选择人物视频')}}</strong><small>{{t(video.file?'点击更换':'MP4 · 最长30秒 · 最大25MB')}}</small></button>
        <p v-if="remainingTrials>0&&!account?.videoTrial?.unlimited" :class="s.note">{{t('新用户免费试用最多10秒。')}}</p>
        <p v-if="trialTooLong" :class="s.error" role="alert">{{t('免费试用仅支持10秒以内视频，请重新上传。')}}</p>
        <div v-if="video.file&&!video.validating" :class="s.fileRow"><span :class="s.fileIcon" aria-hidden="true">▷</span><button type="button" :class="s.fileInfo" :disabled="jobsState.submitting||jobsState.preparing" :aria-label="t('点击更换')" @click="fileInput?.click()"><span :class="s.fileName" :title="video.file.name">{{video.file.name}}</span><span :class="s.videoDuration">{{video.seconds?.toFixed(2)}}{{t(' 秒')}} · MP4 · {{t('点击更换')}}</span></button><button type="button" :disabled="jobsState.submitting||jobsState.preparing" @click="removeVideo">{{t('移除')}}</button></div>
        <p v-if="video.file&&video.hasAudio&&!video.validating" :class="s.note" role="status">{{t('音轨将在提交时自动移除。')}}</p>
        <div :class="s.fieldHeading"><h2>{{t('服装参考图')}}</h2><span>{{input.garments.length}} / 1</span></div>
        <div :class="s.imageColumn">
        <RouterLink to="/wardrobe?from=video" class="upload-inspiration" :aria-label="t('从衣装灵感选图')" :title="t('从衣装灵感选图')"><StudioIcon name="hanger"/><span>{{t('衣装灵感')}}</span><span aria-hidden="true">↗</span></RouterLink>
        <input ref="imageInput" :class="base['visually-hidden']" type="file" accept="image/jpeg,image/png,image/webp" :aria-label="t('选择视频换装服装图')" tabindex="-1" @change="pickImages"/>
        <div :class="s.imageUpload">
          <button type="button" :class="s.imageUploadSurface" :aria-label="t(selected?'更换服装':'选择服装图片')" :disabled="jobsState.submitting||jobsState.preparing||input.processing" @click="imageInput?.click()"><img v-if="selected" :src="selected.previewUrl" :alt="t('本次换装服装参考图')"/><template v-else><span aria-hidden="true">＋</span><strong>{{t('选择服装图片')}}</strong></template></button>
          <button v-if="selected" type="button" :class="s.removeImage" :disabled="jobsState.submitting||jobsState.preparing||input.processing" :aria-label="t('移除服装')" @click="removeGarment(selected.id)">×</button>
          <p :class="s.imageMeta">JPG / PNG / WebP · ≤10MB<template v-if="selected"> · {{t('点击更换')}}</template></p>
        </div></div>
        <p v-if="input.processing" role="status" :class="s.note">{{t('图片处理中…')}}</p>
        <p v-if="input.error" role="alert" :class="s.error">{{t(input.error)}}</p>
        <p v-if="importing" role="status" class="library-import">{{t('正在装入所选衣装…')}} <button type="button" @click="cancelImport">{{t('取消')}}</button></p>
        <p v-if="importError" role="alert" class="library-import">{{t(importError)}} <button type="button" @click="importLooks">{{t('重试')}}</button></p>
        <div v-if="jobsState.preparing" :class="s.preparation" role="status"><strong>{{t(preparationLabel)}}</strong><progress :aria-label="t('视频处理进度')" max="100" :value="jobsState.preparation?.percent"/><button type="button" @click="cancelPreparation">{{t('取消处理')}}</button></div>
        <div v-else-if="video.validating" :class="s.preparation" role="status"><strong>{{t('正在检查视频…')}}</strong><button type="button" @click="cancel">{{t('取消')}}</button></div>
        <p v-if="video.error" role="alert" :class="s.error">{{t(video.error)}}</p>
      </section>
      <template #footer>
        <div :class="s.submitArea" data-video-submit>
          <label :class="s.consent"><input v-model="consent" type="checkbox" :disabled="jobsState.submitting||jobsState.preparing"/><span>{{t('同意云端处理 · ')}}<RouterLink to="/privacy#video" target="_blank" rel="noopener noreferrer">{{t('隐私说明 ↗')}}</RouterLink></span></label>
          <div :class="s.submitRow"><p v-if="service&&!service.available" role="status">{{t(service.message)}}</p><button type="button" :class="s.generate" :disabled="!canSubmit" @click="submit">{{t(submitLabel)}}<span aria-hidden="true">↗</span></button></div>
          <p v-if="jobsState.error||accountSnapshot.error" role="alert" :class="s.error">{{t(jobsState.error??accountSnapshot.error??'')}}</p>
        </div>
      </template>
      </StudioSidebar>
      <div ref="slot" :class="base['preview-slot']"><WorkspacePreview :class="s.output" aria-labelledby="video-preview-title">
        <div data-preview-heading :class="s.outputHeading"><h2 id="video-preview-title">{{t(showResult&&resultUrl?'换装结果':'视频预览')}}</h2><span>{{t(status)}}</span><button v-if="selectedJob" type="button" :class="s.returnCreate" @click="returnCreate">{{t('返回创作')}}</button></div>
        <div data-preview-viewport :class="base['preview-viewport']"><div ref="stage" data-preview-stage data-video-preview :class="s.stage">
          <div v-if="jobsState.preparing" :class="s.empty" role="status"><h3>{{t('正在准备你的视频')}}</h3><p>{{t('音轨会自动移除，完成后即可提交。')}}</p></div>
          <div v-else-if="video.validating" :class="s.empty"><h3>{{t('正在准备你的视频')}}</h3><p>{{t('音轨会自动移除，完成后即可预览。')}}</p></div>
          <div v-else-if="showJobNotice" :class="s.empty" role="alert"><h3>{{t(status)}}</h3><p>{{t(jobNotice||'')}}</p><button type="button" @click="refreshJobs">{{t('刷新任务')}}</button></div>
          <template v-else-if="showResult&&resultUrl">
            <div v-if="resultFailed" :class="s.empty"><p>{{t('暂时无法播放结果')}}</p><button type="button" @click="reloadResult">{{t('重新加载')}}</button></div>
            <video v-else ref="mediaElement" :key="resultUrl" :data-mirrored="frame.mirrored" :src="resultUrl" controls playsinline preload="metadata" :aria-label="t('生成的换装视频')" @loadeddata="onResultLoaded" @error="onResultError"/>
          </template>
          <video v-else-if="video.url" ref="mediaElement" :key="video.url" :data-mirrored="frame.mirrored" :src="video.url" controls muted playsinline preload="metadata" :aria-label="t('本地人物视频预览')" @loadeddata="onLocalLoaded" @error="onLocalError"/>
          <div v-else :class="s.empty"><span aria-hidden="true" :class="s.filmFrame">▷</span><h3>{{t('选择人物视频和服装参考图')}}</h3><p>{{t('支持1—30秒 MP4，含音轨时自动移除。')}}</p><button type="button" data-stage-start :class="base['stage-start']" @click="fileInput?.click()"><StudioIcon name="upload"/>{{t('选择人物视频')}}</button></div>
          <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!previewReady||showJobNotice||(!resultVisible&&!localVisible)" @fullscreen="toggleFullscreen" @capture="capture"/>
          <div v-if="processing" role="status" :class="s.processing"><span :class="s.spinner" aria-hidden="true"/>{{t(selectedJob?VIDEO_STATE_LABEL[selectedJob.state]:'')}}<small>{{t('可离开页面，稍后回来查看')}}</small></div>
        </div></div>
        <PreviewControls :view-label="t('画面切换')">
          <template #views><button type="button" :aria-pressed="!showResult" :disabled="!video.url" @click="showResult=false">{{t('原视频')}}</button><button type="button" :aria-pressed="showResult" :disabled="!resultUrl" @click="showResult=true">{{t('换装结果')}}</button></template>
          <template #actions><MirrorButton :mirrored="frame.mirrored" :disabled="downloadBusy" @toggle="toggleMirror"/><button v-if="resultUrl" type="button" data-preview-action data-preview-primary @click="onDownload"><StudioIcon name="download"/>{{t(downloadBusy?'取消导出':'下载视频')}}</button><button v-else type="button" data-preview-action data-preview-primary disabled :title="t('生成完成后可下载MP4')"><StudioIcon name="download"/>{{t('下载视频')}}</button></template>
        </PreviewControls>
      </WorkspacePreview></div>
    </div>
    <footer :class="base['creation-footer']"><RouterLink to="/privacy#video" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink><RouterLink to="/works">{{t('我的作品')}} ↗</RouterLink></footer>
  </main>
</template>
