<script setup lang="ts">
import {computed} from 'vue';
import {usageQuote,type BillingScene} from '../lib/billing';
import {t} from './preferences';
import type {VideoJobView} from '../lib/video/policy';
const props=defineProps<{scene:BillingScene;seconds:number|null|undefined;inline?:boolean;completed?:boolean;resultSeconds?:number|null;resultPending?:boolean;billing?:VideoJobView['billing']}>();
const quote=computed(()=>{if(!props.seconds)return null;try{return usageQuote(props.scene,props.seconds);}catch{return null;}});
</script>
<template>
  <div v-if="completed||quote" class="billing-estimate" :class="{inline}">
    <template v-if="completed">
      <span>{{t('结果时长')}} <strong v-if="resultSeconds!=null">{{resultSeconds.toFixed(2)}} {{t('秒')}}</strong><small v-else>{{t(resultPending?'核验中…':'暂无法核验')}}</small></span>
      <small v-if="billing?.state==='settled'||billing?.state==='released'">{{t('实际消耗')}} <strong>{{billing.chargedCredits}} {{t('积分')}}</strong> · {{t('返还')}} {{billing.returnedCredits}} {{t('积分')}}</small>
      <small v-else>{{t(billing?'积分待结算':'本次未扣积分')}}</small>
    </template>
    <template v-else-if="quote">
      <span>{{t('上传时长')}} {{seconds?.toFixed(2)}} {{t('秒')}} · {{t('预计预留')}} <strong>{{quote.credits}} {{t('积分')}}</strong></span>
      <small>{{t('按结果时长结算，不足1秒向上取整')}}</small>
    </template>
  </div>
</template>
<style scoped>
.billing-estimate { display:flex; flex-direction:column; gap:5px; padding:11px 12px; margin-top:12px; border-radius:9px; background:var(--paper); font-size:12px; color:var(--muted); line-height:1.6; }
.billing-estimate strong { color:var(--accent); font-weight:600; font-variant-numeric:tabular-nums; }
.billing-estimate small { font-size:11px; }
.billing-estimate.inline { flex-direction:row; align-items:center; gap:10px; margin:0; padding:0; background:transparent; white-space:nowrap; }
</style>
