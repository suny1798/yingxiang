<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { homeShowcaseScenes as scenes, bindHeroWheel } from '../lib/public-home';
import { t } from './preferences';
import s from '../components/site/home-showcase.module.css';
const root=ref<HTMLElement|null>(null),index=ref(0),hidden=ref(false),reducedMotion=ref(true);
let timer:ReturnType<typeof setTimeout>|undefined;
let motion:MediaQueryList|undefined;
let stopWheel:(()=>void)|undefined;
const syncMotion=()=>{reducedMotion.value=motion?.matches??true;};
const syncVisibility=()=>{hidden.value=document.hidden;};
function updateWheel() {
  stopWheel?.(); const hero=root.value?.closest<HTMLElement>('[data-home-hero]'),content=document.getElementById('home-content');
  if(hero&&content)stopWheel=bindHeroWheel(hero,content,reducedMotion.value);
}
watch([hidden,reducedMotion,index],()=>{
  clearTimeout(timer);
  if(!hidden.value&&!reducedMotion.value)timer=setTimeout(()=>{index.value=(index.value+1)%scenes.length;},6000);
},{immediate:true});
watch(reducedMotion,updateWheel);
onMounted(()=>{
  motion=window.matchMedia('(prefers-reduced-motion: reduce)');syncMotion();syncVisibility();
  motion.addEventListener('change',syncMotion);document.addEventListener('visibilitychange',syncVisibility);updateWheel();
});
onUnmounted(()=>{clearTimeout(timer);stopWheel?.();motion?.removeEventListener('change',syncMotion);document.removeEventListener('visibilitychange',syncVisibility);});
function choose(direction:number) {index.value=(index.value+direction+scenes.length)%scenes.length;}
function keydown(event:KeyboardEvent) {
  if(event.key==='ArrowLeft'){event.preventDefault();choose(-1);}
  if(event.key==='ArrowRight'){event.preventDefault();choose(1);}
}
</script>
<template>
  <section ref="root" :class="s.showcase" :aria-roledescription="t('轮播')" :aria-label="t('映想写实创作背景')" @keydown="keydown">
    <div :class="s.frame"><div v-for="(item,value) in scenes" :key="item.image" role="group" :aria-roledescription="t('幻灯片')" :aria-label="`${value+1} / ${scenes.length}`" :aria-hidden="value!==index" :class="s.slide" :data-active="value===index"><img :src="item.image" :alt="t(item.alt)" :width="item.width" :height="item.height" loading="eager" decoding="async"></div></div>
    <div :class="s.arrows"><button type="button" :aria-label="t('上一张背景')" @click="choose(-1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7"/></svg></button><button type="button" :aria-label="t('下一张背景')" @click="choose(1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></button></div>
  </section>
</template>
