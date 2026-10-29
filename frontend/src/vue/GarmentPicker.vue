<script setup lang="ts">
import { computed,ref } from 'vue';
import type { GarmentInput } from '../lib/images/garment-input';
import { MAX_GARMENTS } from '../lib/limits';
import { t } from './preferences';
import StudioIcon from './StudioIcon.vue';
import s from '../components/studio/studio.module.css';
const props=defineProps<{input:ReturnType<GarmentInput['getSnapshot']>}>();
const emit=defineEmits<{upload:[files:File[]];select:[id:string];remove:[id:string];cancel:[]}>();
const file=ref<HTMLInputElement|null>(null),dragging=ref(false);
defineExpose({open:()=>file.value?.click()});
const selected=computed(()=>props.input.garments.find(item=>item.id===props.input.selectedId)),full=computed(()=>props.input.garments.length>=MAX_GARMENTS);
function change(event:Event){const element=event.target as HTMLInputElement;emit('upload',Array.from(element.files??[]));element.value='';}
function drop(event:DragEvent){dragging.value=false;emit('upload',Array.from(event.dataTransfer?.files??[]));}
</script>
<template>
  <section :class="[s['garment-panel'],s.panel,s['compact-picker']]" aria-labelledby="garment-title">
    <div :class="s['section-heading']"><h2 id="garment-title">{{t('服装参考图')}}</h2><span :class="s['wardrobe-count']">{{input.garments.length}} / {{MAX_GARMENTS}}</span></div>
    <slot name="settings" />
    <input ref="file" :class="s['visually-hidden']" type="file" multiple accept="image/jpeg,image/png,image/webp" tabindex="-1" :aria-label="t('选择服装参考图，可多选')" @change="change"/>
    <button :class="[s['upload-zone'],{[s['has-image']]:selected,[s['drag-over']]:dragging}]" type="button" :aria-label="t('添加服装参考图')" aria-describedby="file-help" @click="file?.click()" @dragover.prevent="dragging=true" @dragleave="dragging=false" @drop.prevent="drop">
      <span v-if="!selected" :class="s['upload-empty']"><img :class="s['upload-sample']" src="/assets/garment-sample.svg" alt="" aria-hidden="true"/><span :class="s['upload-icon']"><StudioIcon name="upload"/></span><strong>{{t('点击或拖入多张图片')}}</strong><span>{{t('平铺或挂拍的服装图效果更好')}}</span></span>
      <span v-else :class="s['garment-preview']"><img :src="selected.previewUrl" :alt="t('当前选中的服装参考图')"/><span :class="s['replace-label']"><StudioIcon name="upload"/>{{t(full?'已满6张':'添加图片')}}</span></span>
    </button>
    <div :class="s['upload-meta']"><span id="file-help">{{t('JPG / PNG / WebP · 每张≤10MB')}}</span></div>
    <template v-if="input.garments.length"><div :class="s['wardrobe-grid']" role="group" :aria-label="t('服装参考图，点击切换')"><div v-for="(item,index) in input.garments" :key="item.id" :class="s['wardrobe-item']"><button type="button" :class="s['wardrobe-choice']" :aria-label="`${t('选择服装')} ${index+1}: ${item.name}`" :aria-pressed="input.selectedId===item.id" :title="item.name" @click="emit('select',item.id)"><img :src="item.previewUrl" alt=""/><span>{{String(index+1).padStart(2,'0')}}</span></button><button type="button" :class="s['wardrobe-remove']" :aria-label="`${t('移除服装')} ${index+1}: ${item.name}`" @click="emit('remove',item.id)">×</button></div><button v-if="!full" type="button" :class="s['wardrobe-add']" :aria-label="t('继续添加服装图片')" @click="file?.click()"><StudioIcon name="upload"/><span>{{t('添加')}}</span></button></div><p :class="s['wardrobe-hint']" aria-live="polite">{{t('点击缩略图，切换服装')}}</p></template>
    <p v-if="input.processing" role="status" :class="s['section-description']">{{t('图片处理中… ')}}<button type="button" :class="s['text-button']" @click="emit('cancel')">{{t('取消')}}</button></p>
    <p v-if="input.error" :class="s['inline-error']" role="alert">{{t(input.error)}}</p>
  </section>
</template>
