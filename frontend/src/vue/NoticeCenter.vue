<script setup lang="ts">
import { shallowRef, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { notices } from '../lib/notices';
import { t } from './preferences';
import s from '../components/notice-center.module.css';
const values = shallowRef(notices.getSnapshot());
const target = shallowRef<HTMLElement|null>(null);
const host = ref<HTMLDivElement|null>(null);
let observer: MutationObserver|undefined;
let stop: (()=>void)|undefined;
onMounted(() => {
  stop = notices.subscribe(() => { values.value = notices.getSnapshot(); });
  const update = () => { target.value = document.querySelector<HTMLDialogElement>('dialog[open]') ?? document.body; };
  update(); observer = new MutationObserver(update);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
});
onUnmounted(() => { stop?.(); observer?.disconnect(); });
watch([values,target], async () => {
  await nextTick(); const element = host.value;
  if (!element || typeof element.showPopover !== 'function') return;
  try { if (element.matches(':popover-open')) element.hidePopover(); if (values.value.length) element.showPopover(); } catch { /* 保留固定浮层。 */ }
},{flush:'post'});
</script>

<template>
  <Teleport v-if="target" :to="target">
    <div ref="host" popover="manual" :class="s.host" :data-visible="!!values.length" :aria-label="t('操作通知')">
      <section v-for="item in values" :key="item.id" :class="s.notice" :data-kind="item.kind" :role="item.kind==='error'?'alert':'status'" :aria-live="item.kind==='error'?'assertive':'polite'">
        <span :class="s.symbol" aria-hidden="true">{{item.kind==='error'?'!':item.kind==='success'?'✓':item.kind==='progress'?'◷':'i'}}</span>
        <div :class="s.content"><strong>{{t(item.kind==='error'?'操作未完成':item.kind==='success'?'已完成':item.kind==='progress'?'正在处理视频':'提示')}}</strong><p>{{t(item.message)}}</p>
          <template v-if="item.kind==='progress'"><progress :aria-label="t(item.label??'视频准备进度')" :max="100" :value="item.progress"/><span :class="s.progressLabel">{{t(item.label??'')}}{{item.progress===undefined?'':` ${Math.round(item.progress)}%`}}</span></template>
        </div>
        <button :class="s.close" type="button" :aria-label="t('关闭提示')" @click="notices.dismiss(item.id)">×</button>
      </section>
    </div>
  </Teleport>
</template>
