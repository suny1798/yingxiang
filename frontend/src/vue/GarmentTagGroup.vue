<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { preferences, t } from './preferences';
import { tagLabels } from '../lib/garment-library';
import s from './pages/wardrobe.module.css';

const props=defineProps<{name:string;tags:readonly string[];selected:readonly string[];initiallyExpanded?:boolean}>();
const emit=defineEmits<{toggle:[tag:string]}>();
const expanded=ref(Boolean(props.initiallyExpanded)),container=ref<HTMLDivElement|null>(null);
let observer:ResizeObserver|undefined;
// 两行之外的按钮保留布局用于自适应换行，但不进入键盘或辅助技术导航。
function syncHidden(){
  const element=container.value;if(!element)return;
  for(const button of element.querySelectorAll('button')){
    const hidden=!expanded.value&&button.offsetTop+button.offsetHeight>element.clientHeight+1;
    button.inert=hidden;
    if(hidden)button.setAttribute('aria-hidden','true');else button.removeAttribute('aria-hidden');
  }
}
watch([expanded,preferences.locale],async()=>{await nextTick();syncHidden();},{flush:'post'});
onMounted(()=>{observer=new ResizeObserver(syncHidden);if(container.value)observer.observe(container.value);void document.fonts.ready.then(syncHidden);syncHidden();});
onUnmounted(()=>observer?.disconnect());
</script>

<template>
  <fieldset :data-tag-group="name"><legend>{{t(name)}}</legend>
    <div :id="`tag-group-${name}`" ref="container" :class="[s.tags,s.filterTags,{[s.tagPreview]:!expanded}]">
      <button v-for="tag in tags" :key="tag" type="button" :aria-pressed="selected.includes(tag)" @click="emit('toggle',tag)">{{preferences.locale.value==='en'?tag:tagLabels[tag]??tag}}</button>
    </div>
    <button type="button" :class="s.tagToggle" :aria-expanded="expanded" :aria-controls="`tag-group-${name}`" @click="expanded=!expanded"><span aria-hidden="true">{{expanded?'▾':'▸'}}</span>{{t(expanded?'收起标签':'展开全部标签')}}</button>
  </fieldset>
</template>
