<script setup lang="ts">
import { t } from './preferences';
import s from '../components/studio/studio-modes.module.css';
defineProps<{active:'realtime'|'video'|'prompt'}>();
</script>
<template><nav :class="s.modes" :aria-label="t('创作模式')">
  <RouterLink to="/studio" :aria-current="active==='realtime'?'page':undefined"><span aria-hidden="true">◉</span>{{t('实时换装')}}</RouterLink>
  <RouterLink to="/studio/video" :aria-current="active==='video'?'page':undefined"><span aria-hidden="true">▷</span>{{t('视频换装')}}</RouterLink>
  <RouterLink to="/studio/edit" :aria-current="active==='prompt'?'page':undefined"><span aria-hidden="true">✳</span>{{t('实时编辑')}}</RouterLink>
</nav></template>
