<script setup lang="ts">
import s from '../components/studio/studio.module.css';
import { studioIconShapes,type StudioIconName } from '../lib/studio/icon-paths';
defineProps<{name:StudioIconName}>();
</script>
<template><svg :class="s.icon" viewBox="0 0 24 24" aria-hidden="true"><template v-for="(shape,index) in studioIconShapes[name]" :key="index"><path v-if="shape.kind==='path'" :d="shape.d"/><circle v-else-if="shape.kind==='circle'" :cx="shape.cx" :cy="shape.cy" :r="shape.r"/><rect v-else :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :rx="shape.rx"/></template></svg></template>
