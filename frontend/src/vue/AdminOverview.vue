<script setup lang="ts">
import { toRef } from 'vue';
import type { Overview,ServiceStatus } from '../lib/api-schema';
import { sceneName } from './admin-labels';
import { useAdminData,useSay } from './use-admin-console';
import s from '../components/site/admin.module.css';
const props=defineProps<{revision:number}>();
const say=useSay();
const state=useAdminData<Overview>(()=>'/api/admin/overview',toRef(props,'revision'));
const stats=(data:Overview)=>[[data.users,say('注册用户','Users')],[data.videoJobs,say('视频任务','Video tasks')],[data.usageAttempts,say('实时申请','Live requests')],[data.unknownResults,say('结果待核查','Unknown outcomes')]] as Array<[number,string]>;
const budget=(row:ServiceStatus)=>row.budgetUsd===null?'—':`${row.reservedUsd.toFixed(2)} / ${row.budgetUsd.toFixed(2)}`;
const limit=(row:ServiceStatus)=>`${row.requests} / ${row.maxRequests??'—'}`;
</script>
<template>
  <div v-if="state.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
  <div v-else-if="state.error" :class="s.error" role="alert">{{state.error}}</div>
  <template v-else-if="state.data">
    <div :class="s.stats"><div v-for="[count,label] in stats(state.data)" :key="label" :class="s.stat"><strong>{{count}}</strong><span>{{label}}</span></div></div>
    <section :class="s.panel"><h2>{{say('服务运行边界','Service boundaries')}}</h2><div :class="s.notice">{{say('后台权限与生成权益分开。恢复服务不会提高原有预算、解除测试账号限制或清空历史占用；现有任务不会因暂停新生成而被取消。','Admin access is separate from generation entitlements. Resuming services does not increase budgets, remove test-account restrictions, or reset usage. Pausing new requests does not cancel existing tasks.')}}</div><div :class="s.tableWrap"><table :class="s.table"><thead><tr><th v-for="label in [say('功能','Feature'),say('配置状态','Configuration'),say('后台暂停','Admin pause'),say('预留 / 预算 USD','Reserved / budget USD'),say('申请数 / 上限','Requests / limit')]" :key="label">{{label}}</th></tr></thead><tbody><tr v-for="row in state.data.services" :key="row.scene"><td>{{sceneName(row.scene,say)}}</td><td>{{row.configured?say('已配置','Configured'):say('未就绪','Not ready')}}</td><td>{{row.paused?say('已暂停','Paused'):say('未暂停','Not paused')}}</td><td>{{budget(row)}}</td><td>{{limit(row)}}</td></tr></tbody></table></div></section>
    <section :class="s.panel"><h2>{{say('账号与支付','Accounts & payments')}}</h2><p :class="s.muted">{{say('可用管理员','Active admins')}} {{state.data.admins}} · {{say('已暂停账号','Suspended accounts')}} {{state.data.disabledUsers}} · {{say('沙盒订单','Sandbox orders')}} {{state.data.sandboxOrders}}</p><p>{{say('Stripe 沙盒','Stripe sandbox')}}：{{state.data.sandboxEnabled?say('已开放','Enabled'):say('未开放','Disabled')}} · {{say('正式支付未开放','Live payments are disabled')}}</p></section>
  </template>
</template>
