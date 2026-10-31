<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue';
import {envelopeData} from '../lib/api-response';
import {type WalletView} from '../lib/billing';
import {t} from './preferences';
const props=defineProps<{userId:string;showHistory?:boolean}>();
const value=ref<WalletView|null>(null),error=ref(''),busy=ref(false);
let abort:AbortController|undefined;
async function load(){
  abort?.abort();const current=new AbortController();abort=current;busy.value=true;error.value='';value.value=null;
  try{const response=await fetch('/api/billing/wallet',{cache:'no-store',signal:current.signal});if(!response.ok)throw new Error();const result=envelopeData<WalletView>(await response.json());if(!current.signal.aborted)value.value=result;}
  catch{if(!current.signal.aborted)error.value='积分服务暂不可用，请稍后刷新。';}
  finally{if(abort===current)busy.value=false;}
}
watch(()=>props.userId,load,{immediate:true});onUnmounted(()=>abort?.abort());
const states={reserved:'费用预留中',review:'用量待核查',settled:'已结算',released:'已全部返还'};
const scenes={studio:'实时换装',video:'视频换装',prompt:'实时编辑'};
</script>
<template>
  <section class="wallet-panel" :aria-label="t('我的积分')">
    <header><h2>{{t('我的积分')}}</h2><button type="button" :disabled="busy" @click="load">{{t(busy?'读取中…':'刷新积分')}}</button></header>
    <p v-if="error" role="status">{{t(error)}}</p>
    <template v-else-if="value">
      <div class="balances"><div><span>{{t('可用积分')}}</span><strong>{{value.real.availableCredits}} {{t('积分')}}</strong><small>{{t('预留中')}} {{value.real.reservedCredits}} {{t('积分')}}</small></div><div><span>{{t('沙盒测试积分')}}</span><strong>{{value.sandbox.availableCredits}} {{t('积分')}}</strong><small>{{t('测试积分不能用于真实生成')}}</small></div></div>
      <p>{{t('三种功能统一每秒消耗1积分，不足1秒按1秒计费。')}} <RouterLink to="/pricing">{{t('去充值')}} ↗</RouterLink></p>
      <p v-if="!value.real.billingEnabled">{{t('积分扣费尚未开放，当前测试权益保持不变。')}}</p>
      <p v-else-if="!value.real.realtimeMeterReady">{{t('实时生成积分扣费待开放。')}}</p>
      <div v-if="showHistory" class="usage"><h3>{{t('积分使用记录')}}</h3><p v-if="!value.real.history.length">{{t('暂无积分扣费记录')}}</p><div v-for="entry in value.real.history" :key="entry.id"><span>{{t(scenes[entry.scene])}} · {{t(states[entry.state])}}</span><strong>{{entry.charged_credits===null?t('待结算'):entry.charged_credits+' '+t('积分')}}</strong><small>{{t('预留积分')}} {{entry.reserved_credits}}<template v-if="entry.charged_credits!==null"> · {{t('返还积分')}} {{entry.reserved_credits-entry.charged_credits}}</template><template v-if="entry.settled_ms!==null"> · {{t('实际计费')}} {{Math.ceil(entry.settled_ms/1000)}} {{t('秒')}}</template></small></div></div>
    </template>
  </section>
</template>
<style scoped>
.wallet-panel { padding:24px; border:1px solid var(--line); border-radius:16px; background:var(--surface); margin-bottom:24px; }
header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; } h2 { font-size:17px; } button { border:0; background:transparent; color:var(--accent); font-size:12px; } button:focus-visible,a:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.balances { display:grid; grid-template-columns:1fr 1fr; gap:24px; }.balances > div { display:flex; flex-direction:column; gap:9px; padding:18px; border-radius:12px; background:var(--paper); }.balances span { font-size:13px; }.balances strong { font-size:30px; font-weight:600; font-variant-numeric:tabular-nums; }.balances small,p { font-size:12px; color:var(--muted); line-height:1.8; } p { margin-top:14px; } a { color:var(--accent); white-space:nowrap; }
.usage { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); }.usage h3 { font-size:14px; }.usage > div { display:grid; grid-template-columns:1fr auto; gap:6px 16px; padding:14px 0; border-bottom:1px solid var(--line); font-size:13px; }.usage small { color:var(--muted); grid-column:1 / -1; font-size:11px; }
</style>
