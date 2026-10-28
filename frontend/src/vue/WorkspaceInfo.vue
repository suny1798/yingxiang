<script setup lang="ts">
import { ref, useId } from 'vue';
import { t } from './preferences';
import s from '../components/studio/studio.module.css';
defineProps<{ label: string }>();
const dialog = ref<HTMLDialogElement | null>(null), title = useId();
</script>
<template>
  <button type="button" :class="s['workspace-info-trigger']" @click="dialog?.showModal()">{{ t(label) }} ↗</button>
  <dialog ref="dialog" :class="s['workspace-info']" :aria-labelledby="title">
    <div :class="s['dialog-heading']"><h2 :id="title">{{ t(label) }}</h2><button type="button" :class="s['icon-button']" :aria-label="t('关闭面板')" @click="dialog?.close()">×</button></div>
    <slot />
  </dialog>
</template>
