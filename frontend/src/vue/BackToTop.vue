<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from './preferences';

defineProps<{ raised?: boolean }>();
const route=useRoute(),overflow=ref(false);
let resizeObserver:ResizeObserver|undefined,mutationObserver:MutationObserver|undefined,frame=0,mounted=false;
function schedule(){
  if(!mounted||frame)return;
  frame=requestAnimationFrame(()=>{
    frame=0;
    const page=document.scrollingElement;
    overflow.value=Boolean(page&&page.scrollHeight>document.documentElement.clientHeight+1);
  });
}
function goTop(){window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
watch(()=>route.fullPath,schedule,{flush:'post'});
onMounted(()=>{
  mounted=true;
  resizeObserver=new ResizeObserver(schedule);
  resizeObserver.observe(document.body);resizeObserver.observe(document.documentElement);
  mutationObserver=new MutationObserver(schedule);
  mutationObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  window.addEventListener('resize',schedule);
  document.addEventListener('load',schedule,true);
  document.addEventListener('toggle',schedule,true);
  void document.fonts.ready.then(schedule);
  schedule();
});
onUnmounted(()=>{
  mounted=false;cancelAnimationFrame(frame);
  resizeObserver?.disconnect();mutationObserver?.disconnect();
  window.removeEventListener('resize',schedule);
  document.removeEventListener('load',schedule,true);
  document.removeEventListener('toggle',schedule,true);
});
</script>

<template>
  <button v-if="overflow" type="button" class="back-to-top" :class="{'back-to-top-raised':raised}" :aria-label="t('回到顶部')" :title="t('回到顶部')" @click="goTop">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10l6-6 6 6M12 4v16"/></svg>
  </button>
</template>

<style scoped>
.back-to-top { position:fixed; z-index:22; right:24px; bottom:24px; display:grid; place-items:center; width:44px; height:44px; padding:0; border:1px solid var(--line); border-radius:50%; background:var(--surface); color:var(--accent); box-shadow:0 4px 18px #34212a18; transition:background-color .18s,color .18s,transform .18s; }
.back-to-top svg { width:19px; height:19px; }
.back-to-top:hover { background:var(--accent); color:var(--on-accent); transform:translateY(-3px); }
.back-to-top:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
.back-to-top-raised { bottom:128px; }
@media (prefers-reduced-motion:reduce) { .back-to-top { transition:none; } }
@media print { .back-to-top { display:none; } }
</style>
