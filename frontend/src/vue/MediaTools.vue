<script setup lang="ts">
import { t } from './preferences';
import StudioIcon from './StudioIcon.vue';
import s from '../components/studio/media-tools.module.css';
defineProps<{fullscreen:boolean;supported:boolean;capturing:boolean;disabled:boolean}>();
const emit=defineEmits<{fullscreen:[];capture:[]}>();
</script>
<template><div :class="s.tools" :aria-label="t('画面工具')">
  <button type="button" :aria-label="t(fullscreen?'退出全屏':'全屏观看')" :title="t(!supported?'当前浏览器不支持全屏，请尝试桌面 Chrome 或 Edge。':fullscreen?'退出全屏':'全屏观看')" :disabled="disabled||!supported" @click="emit('fullscreen')"><StudioIcon :name="fullscreen?'fullscreenExit':'fullscreen'"/><span>{{t(fullscreen?'退出全屏':'全屏')}}</span></button>
  <button type="button" :aria-label="t('保存当前帧')" :title="t('保存当前帧为PNG')" :disabled="disabled||capturing" @click="emit('capture')"><StudioIcon name="snapshot"/><span>{{t(capturing?'截图中':'截图')}}</span></button>
</div></template>
