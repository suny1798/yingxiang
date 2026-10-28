<script setup lang="ts">
import { ref,onMounted,onUnmounted,watch } from 'vue';
import { useLocalVideoStudio } from '../use-local-video-studio';
import { useFrameTools } from '../use-frame-tools';
import { mountPreviewSurface } from '../../lib/media/preview-layout';
import { VIDEO_POLICY } from '../../lib/video/policy';
import { t } from '../preferences';
import StudioModes from '../StudioModes.vue';
import StudioIcon from '../StudioIcon.vue';
import MediaTools from '../MediaTools.vue';
import MirrorButton from '../MirrorButton.vue';
import base from '../../components/studio/studio.module.css';
import s from '../../components/studio/video-studio.module.css';
import action from '../../components/studio/preview-action.module.css';
const {media,video,input,selected,choose,uploadImages,remove,cancel}=useLocalVideoStudio();
const slot=ref<HTMLDivElement|null>(null),stage=ref<HTMLElement|null>(null),mediaElement=ref<HTMLVideoElement|null>(null),previewReady=ref(false),fileInput=ref<HTMLInputElement|null>(null),imageInput=ref<HTMLInputElement|null>(null);
const {snapshot:frame,toggleMirror,toggleFullscreen,capture}=useFrameTools({stage:()=>stage.value,video:()=>mediaElement.value,stem:()=> '映想-本地人物视频',mirrored:false});
let stopLayout:(()=>void)|undefined;
onMounted(()=>{stopLayout=mountPreviewSurface(slot.value);});onUnmounted(()=>stopLayout?.());
watch(()=>video.value.url,()=>{previewReady.value=false;});
function pickVideo(event:Event){const element=event.target as HTMLInputElement,file=element.files?.[0];element.value='';choose(file);}
function pickImages(event:Event){const element=event.target as HTMLInputElement,files=Array.from(element.files??[]);element.value='';if(files.length)uploadImages(files);}
</script>
<template>
  <main id="creative-space" :class="[base['page-shell'],base['creation-shell']]">
    <div :class="base['workbench-title']"><h1>{{t('创作空间')}}</h1><span>{{t('视频换装')}}</span><RouterLink to="/account">{{t('我的权益 ↗')}}</RouterLink></div>
    <StudioModes active="video"/>
    <div :class="base.workspace">
      <section :class="s.inputs" :aria-label="t('视频换装素材')">
        <div :class="s.fieldHeading"><h2>{{t('人物视频')}}</h2><span>{{t('1—15秒')}}</span></div>
        <input ref="fileInput" :class="base['visually-hidden']" type="file" accept="video/mp4,.mp4" :aria-label="t('选择人物视频')" tabindex="-1" @change="pickVideo"/>
        <button type="button" :class="s.videoUpload" :title="video.file?.name" @click="fileInput?.click()"><span v-if="video.file&&!video.validating" :class="s.uploadReady" aria-hidden="true"><StudioIcon name="check"/></span><span v-else aria-hidden="true">▷</span><strong>{{t(video.validating?'正在检查视频…':video.file?'视频已就绪':'选择人物视频')}}</strong><small>{{t(video.file?'点击更换':'MP4 · 最长15秒 · 最大25MB')}}</small></button>
        <div v-if="video.file&&!video.validating" :class="s.fileRow"><span :title="video.file.name">{{video.file.name}}</span><span :class="s.videoDuration">{{video.seconds?.toFixed(1)}}{{t(' 秒')}}</span><button type="button" @click="remove">{{t('移除')}}</button></div>
        <p v-if="video.file&&video.hasAudio" :class="s.note" role="status">{{t('检测到音轨；本机预览为静音，云端提交时会自动移除。')}}</p>
        <div :class="s.fieldHeading"><h2>{{t('服装参考图')}}</h2></div>
        <input ref="imageInput" :class="base['visually-hidden']" type="file" accept="image/jpeg,image/png,image/webp" :aria-label="t('选择视频换装服装图')" tabindex="-1" @change="pickImages"/>
        <button type="button" :class="s.imageUpload" :disabled="input.processing||input.garments.length>=6" @click="imageInput?.click()"><img v-if="selected" :src="selected.previewUrl" :alt="t('本次换装服装参考图')"/><template v-else><span aria-hidden="true">＋</span><strong>{{t('选择服装图片')}}</strong><small>JPG / PNG / WebP · ≤10MB</small></template></button>
        <div v-if="input.garments.length" :class="s.wardrobe" role="group" :aria-label="t('视频服装选择')"><div v-for="(item,index) in input.garments" :key="item.id"><button type="button" :aria-pressed="item.id===input.selectedId" :aria-label="t(`使用服装${index+1}`)" @click="media.input.select(item.id)"><img :src="item.previewUrl" alt=""/></button><button type="button" :class="s.removeImage" :aria-label="t(`移除视频服装${index+1}`)" @click="media.input.remove(item.id)">×</button></div><button v-if="input.garments.length<6" type="button" :aria-label="t('添加视频服装图')" @click="imageInput?.click()">＋</button></div>
        <p v-if="input.processing" role="status" :class="s.note">{{t('图片处理中…')}}</p>
        <p v-if="input.error" role="alert" :class="s.error">{{t(input.error)}}</p>
        <div v-if="video.validating" :class="s.preparation" role="status"><strong>{{t('正在检查视频…')}}</strong><button type="button" @click="cancel">{{t('取消')}}</button></div>
        <p v-if="video.error" role="alert" :class="s.error">{{t(video.error)}}</p>
      </section>
      <div ref="slot" :class="base['preview-slot']"><section data-workspace-preview :class="s.output" aria-labelledby="video-preview-title">
        <div data-preview-heading :class="s.outputHeading"><h2 id="video-preview-title">{{t('视频预览')}}</h2><span>{{t(video.url?'本地预览':'等待素材')}}</span></div>
        <div data-preview-toolbar :class="base['frame-toolbar']"><span>{{t('MP4 · 最长 ')}}{{VIDEO_POLICY.maxSeconds}}{{t(' 秒 · 自动移除音轨')}}</span><span>{{t(video.url?`本地预览 · ${video.seconds?.toFixed(1)} 秒`:'生成后可预览与下载')}}</span></div>
        <div data-preview-viewport :class="base['preview-viewport']"><div ref="stage" data-preview-stage :class="s.stage">
          <video v-if="video.url" ref="mediaElement" :key="video.url" :data-mirrored="frame.mirrored" :src="video.url" controls muted playsinline preload="metadata" :aria-label="t('本地人物视频预览')" @loadeddata="previewReady=true" @error="previewReady=false"/>
          <div v-else :class="s.empty"><span aria-hidden="true" :class="s.filmFrame">▷</span><h3>{{t('选择人物视频和服装参考图')}}</h3><p>{{t('支持1—15秒 MP4，含音轨时自动移除。')}}</p><button type="button" data-stage-start :class="base['stage-start']" @click="fileInput?.click()"><StudioIcon name="upload"/>{{t('选择人物视频')}}</button></div>
          <MediaTools :fullscreen="frame.fullscreen" :supported="frame.supported" :capturing="frame.capturing" :disabled="!video.url||!previewReady" @fullscreen="toggleFullscreen" @capture="capture"/>
        </div></div>
        <div data-preview-controls :class="s.previewActions"><div :class="s.switch"><button type="button" aria-pressed="true" :disabled="!video.url">{{t('原视频')}}</button><button type="button" :aria-pressed="false" disabled :title="t('换装服务暂未就绪')">{{t('换装结果')}}</button></div><div :class="s.videoActions"><MirrorButton :mirrored="frame.mirrored" :disabled="false" @toggle="toggleMirror"/><button type="button" data-preview-action :class="action.button" disabled :title="t('生成完成后可下载MP4')"><StudioIcon name="download"/>{{t('下载视频')}}</button></div></div>
        <div data-preview-details :class="base['recording-bar']"><span :class="base['record-hint']">{{t('本地预览 · 不上传')}}</span><div><span role="status">{{t('换装服务暂未就绪')}}</span><RouterLink to="/privacy#video">{{t('隐私说明 ↗')}}</RouterLink></div></div>
      </section></div>
    </div>
    <footer :class="base['creation-footer']"><RouterLink to="/privacy#video" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink><RouterLink to="/works">{{t('我的作品')}} ↗</RouterLink></footer>
  </main>
</template>
