<script setup lang="ts">
import { onUnmounted,ref,watch } from 'vue';
import type { WorkPromptHistory } from '../lib/api-schema';
import { t } from './preferences';
import s from '../components/site/works-page.module.css';
const props=defineProps<{id:string;owner:string;saving:boolean}>();
const result=ref<{key:string;data?:WorkPromptHistory;error?:boolean}|null>(null),revision=ref(0);
let controller:AbortController|null=null,timer:ReturnType<typeof setInterval>|undefined;
const key=()=>`${props.owner}:${props.id}`;
async function read(){
  controller?.abort();const current=new AbortController();controller=current;const expected=key();
  try{
    const response=await fetch(`/api/works/${props.id}/prompts`,{cache:'no-store',signal:current.signal,headers:{'X-Work-Owner':props.owner}});
    if(!response.ok)throw new Error();
    const data=await response.json() as WorkPromptHistory;
    if(!current.signal.aborted)result.value={key:expected,data};
  }catch{ if(!current.signal.aborted)result.value={key:expected,error:true}; }
}
function start(){clearInterval(timer);void read();timer=props.saving?setInterval(()=>{if(!document.hidden)void read();},3000):undefined;}
watch([()=>props.id,()=>props.owner,()=>props.saving,revision],start,{immediate:true});
onUnmounted(()=>{controller?.abort();clearInterval(timer);});
const value=()=>result.value?.key===key()?result.value:null;
const states=()=>value()?.data?.states;
const time=(ms:number)=>`00:${(ms/1000).toFixed(1).padStart(4,'0')}`;
</script>
<template><aside :class="[s.referencePanel,s.promptPanel]" :aria-label="t('本次提示词')">
  <h3>{{t('本次提示词')}}<span v-if="states()">{{states()!.length}} {{t('组')}}</span></h3>
  <p v-if="!value()" role="status">{{t('正在读取提示词…')}}</p>
  <p v-else-if="value()!.error" role="alert">{{t('提示词暂时无法读取。')}} <button type="button" :class="s.promptRetry" @click="revision++">{{t('重试')}}</button></p>
  <p v-else-if="!states()?.length">{{t(saving?'提示词正在随作品保存。':'这件作品未留存当时的提示词，无法补回。')}}</p>
  <template v-else>
    <p :class="s.promptHint">{{t('按同步顺序展示本轮使用的提示词组合。')}}</p>
    <div :class="s.promptScroll" tabindex="0" :aria-label="t('提示词组合记录')"><section v-for="(state,index) in states()" :key="index" :class="s.promptState"><div><time>{{time(state.atMs)}}</time><span>{{t(index===0?'初始组合':'更新组合')}}</span></div><ol><li v-for="(text,item) in state.instructions" :key="item">{{text}}</li></ol></section></div>
  </template>
</aside></template>
