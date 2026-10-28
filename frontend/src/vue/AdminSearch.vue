<script setup lang="ts">
import { useSay } from './use-admin-console';
import s from '../components/site/admin.module.css';
const emit=defineEmits<{submit:[query:string]}>();
const say=useSay();
function submit(event:Event) {
  const form=new FormData(event.currentTarget as HTMLFormElement);
  emit('submit',String(form.get('query')??'').trim());
}
</script>
<template>
  <form :class="s.toolbar" @submit.prevent="submit"><label :class="[s.field,s.search]">{{say('搜索账号或记录编号','Search account or record ID')}}<input name="query" maxlength="80"/></label><slot/><button :class="s.primary" type="submit">{{say('查询','Search')}}</button></form>
</template>
