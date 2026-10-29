<script setup lang="ts">
import { t } from './preferences';
import s from '../components/studio/preview-controls.module.css';

defineProps<{ viewLabel: string }>();
</script>
<template>
  <div data-preview-controls :class="s.bar">
    <div data-preview-views :class="s.views" role="group" :aria-label="viewLabel"><slot name="views" /></div>
    <div :class="s.info"><slot name="info"><RouterLink to="/works">{{ t('自动保存 · 我的作品 ↗') }}</RouterLink></slot></div>
    <div data-preview-actions :class="s.actions"><slot name="actions" /></div>
  </div>
</template>
