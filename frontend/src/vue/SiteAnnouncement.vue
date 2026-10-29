<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue';
import type { Announcement } from '../lib/api-schema';
import { envelopeData } from '../lib/api-response';
import { preferences } from './preferences';
import s from '../components/site/site.module.css';
const value=ref<Announcement|null>(null),dismissed=ref<number|null>(null);
const controller=new AbortController();
async function read() {
  try {
    const response=await fetch('/api/site/announcement',{cache:'no-store',signal:controller.signal});
    if(!response.ok)return;
    const next=envelopeData<Announcement>(await response.json());
    if(!controller.signal.aborted&&next&&Number.isSafeInteger(next.version)&&next.version>=0&&typeof next.enabled==='boolean'&&typeof next.zh==='string'&&typeof next.en==='string'&&(!value.value||next.version>=value.value.version))value.value=next;
  }catch { /* 公告失败不影响页面；不输出内容或诊断对象。 */ }
}
onMounted(()=>{void read();window.addEventListener('focus',read);});
onUnmounted(()=>{controller.abort();window.removeEventListener('focus',read);});
</script>
<template>
  <aside v-if="value?.enabled&&dismissed!==value.version" :class="s.siteAnnouncement" role="status"><span>{{preferences.locale.value==='en'?value.en:value.zh}}</span><button type="button" :aria-label="preferences.locale.value==='en'?'Dismiss announcement':'关闭公告'" @click="dismissed=value.version">×</button></aside>
</template>
