<script setup lang="ts">
import s from '../components/studio/studio.module.css';
defineProps<{name:'camera'|'upload'|'close'}>();
const paths={camera:'M4 7h4l2-3h4l2 3h4v13H4z',upload:'M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5',close:'m6 6 12 12M18 6 6 18'};
</script>
<template><svg :class="s.icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[name]"/><circle v-if="name==='camera'" cx="12" cy="13" r="3.5"/></svg></template>
