<script setup lang="ts">
import { onMounted,onUnmounted,ref } from 'vue';
import type { AdminPending } from './admin';
import { useSay } from './use-admin-console';
import s from '../components/site/admin.module.css';
const props=defineProps<{pending:AdminPending;busy:boolean;error:string}>();
const emit=defineEmits<{close:[];save:[]}>();
const say=useSay();
const dialog=ref<HTMLDialogElement|null>(null);
onMounted(()=>dialog.value?.showModal());
onUnmounted(()=>dialog.value?.close());
function close(){if(!props.busy)emit('close');}
function cancel(event:Event){event.preventDefault();close();}
function backdrop(event:MouseEvent){if(event.target===event.currentTarget&&!props.busy)close();}
</script>
<template>
  <dialog ref="dialog" :class="s.dialog" aria-labelledby="admin-confirm-title" @cancel="cancel" @click="backdrop">
    <h2 id="admin-confirm-title">{{say('确认这次管理操作','Confirm this administrative action')}}</h2>
    <p>{{pending.summary}}</p>
    <p :class="s.muted">{{say('保存后会立即生效，并记录操作原因和修改内容。','Changes take effect immediately and are recorded with the reason in the audit log.')}}</p>
    <div v-if="error" :class="s.error" role="alert">{{error}}</div>
    <footer><button autofocus :class="s.button" type="button" :disabled="busy" @click="close">{{say('取消','Cancel')}}</button><button :class="s.primary" type="button" :disabled="busy" @click="emit('save')">{{busy?say('正在保存…','Saving…'):say('确认保存','Confirm changes')}}</button></footer>
  </dialog>
</template>
