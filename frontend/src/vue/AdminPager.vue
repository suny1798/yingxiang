<script setup lang="ts">
import { useSay } from './use-admin-console';
import s from '../components/site/admin.module.css';
defineProps<{page:number;pages:number;total:number}>();
const emit=defineEmits<{change:[page:number]}>();
const say=useSay();
</script>
<template>
  <div :class="s.pagination"><span>{{total}} {{say('条','records')}} · {{page}} / {{pages}}</span><button :class="s.button" type="button" :disabled="page<=1" @click="emit('change',page-1)">{{say('上一页','Previous')}}</button><button :class="s.button" type="button" :disabled="page>=pages" @click="emit('change',page+1)">{{say('下一页','Next')}}</button></div>
</template>
