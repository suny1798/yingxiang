<script setup lang="ts">
import { ref,watchEffect } from 'vue';
import type { LocalCamera } from '../lib/media/local-camera';
import { t } from './preferences';
import s from '../components/studio/studio.module.css';
const props=defineProps<{stream:MediaStream;camera:LocalCamera;mirrored:boolean}>();
const video=ref<HTMLVideoElement|null>(null);
watchEffect(onCleanup=>{
  const element=video.value,stream=props.stream;if(!element)return;
  let current=true;element.srcObject=stream;
  void element.play().catch(()=>{if(current)props.camera.playbackFailed(stream);});
  onCleanup(()=>{current=false;element.pause();element.srcObject=null;});
},{flush:'post'});
function playing(){const element=video.value;if(element?.srcObject===props.stream&&element.readyState>=2)props.camera.markPlaying(props.stream);}
</script>
<template><video ref="video" :class="s['camera-video']" :data-mirrored="mirrored" autoplay playsinline muted :aria-label="t('本地相机原画，未进行AI处理')" @playing="playing" @error="camera.playbackFailed(stream)"/></template>
