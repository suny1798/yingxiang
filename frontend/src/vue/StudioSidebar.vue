<script setup lang="ts">
import StudioModes from './StudioModes.vue';
import s from '../components/studio/studio-sidebar.module.css';

defineProps<{ active: 'realtime' | 'video' | 'prompt' }>();
</script>

<template>
  <aside :class="s.sidebar" data-studio-sidebar>
    <StudioModes :active="active" />
    <div :class="s.body" data-sidebar-body><slot /></div>
    <div v-if="$slots.footer" :class="s.footer" data-sidebar-footer><slot name="footer" /></div>
  </aside>
</template>
