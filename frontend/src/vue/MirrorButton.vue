<script setup lang="ts">
import { t } from './preferences';
import StudioIcon from './StudioIcon.vue';
import s from '../components/studio/preview-action.module.css';
defineProps<{mirrored:boolean;disabled:boolean}>();
const emit=defineEmits<{toggle:[]}>();
</script>
<template><button type="button" data-mirror-control data-preview-action :class="s.button" :aria-label="t('视频镜像')" :aria-pressed="mirrored" :disabled="disabled" :title="t(mirrored?'镜像已开启，点击关闭':'镜像已关闭，点击开启')" @click="emit('toggle')"><StudioIcon name="mirror"/><span>{{t('镜像')}}</span></button></template>
