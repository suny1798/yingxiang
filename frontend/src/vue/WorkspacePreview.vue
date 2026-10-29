<script setup lang="ts">
import s from '../components/studio/studio.module.css';
</script>
<template>
  <section data-workspace-preview :class="s.panel"><slot /></section>
</template>
