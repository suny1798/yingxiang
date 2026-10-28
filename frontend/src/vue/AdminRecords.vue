<script setup lang="ts">
import { computed,ref,toRef } from 'vue';
import type { AdminRecord,AdminRecords } from '../lib/api-schema';
import { sceneName,stateName } from './admin-labels';
import { preferences } from './preferences';
import { useAdminData,useSay } from './use-admin-console';
import AdminPager from './AdminPager.vue';
import AdminSearch from './AdminSearch.vue';
import s from '../components/site/admin.module.css';
const props=defineProps<{kind:'usage'|'video'|'orders';revision:number}>();
const say=useSay();
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const query=ref(''),state=ref(''),page=ref(1);
const states=computed(()=>props.kind==='usage'?['reserved','unknown','issued','finished']:props.kind==='video'?['submitting','unknown','pending','processing','completed','failed']:['creating','pending','paid','failed','expired']);
const title=computed(()=>props.kind==='orders'?say('全部沙盒订单','All sandbox orders'):props.kind==='video'?say('全部视频任务','All video tasks'):say('实时申请记录','Live generation requests'));
const data=useAdminData<AdminRecords>(()=>`/api/admin/records/${props.kind}?q=${encodeURIComponent(query.value)}&state=${encodeURIComponent(state.value)}&page=${page.value}`,toRef(props,'revision'));
function search(value:string){query.value=value;page.value=1;}
function onState(event:Event){state.value=(event.target as HTMLSelectElement).value;page.value=1;}
function amount(row:AdminRecord){return `¥${((row.amount??0)/100).toFixed(2)}`;}
function duration(row:AdminRecord){return `${row.seconds??'—'}s`;}
</script>
<template>
  <section :class="s.panel">
    <h2>{{title}}</h2>
    <p :class="s.muted">{{say('仅查询业务元数据；不加载用户媒体，不替用户生成，不修改任务结果或支付金额。待核查记录保留原风险占用。','Business metadata only. No user media is loaded, no generation is triggered, and outcomes and payment amounts stay intact. Unknown outcomes retain their risk reservations.')}}</p>
    <AdminSearch @submit="search"><label :class="s.field">{{say('状态','Status')}}<select :value="state" @change="onState"><option value="">{{say('全部','All')}}</option><option v-for="value in states" :key="value" :value="value">{{stateName(value,say)}}</option></select></label></AdminSearch>
    <div v-if="data.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
    <div v-else-if="data.error" :class="s.error" role="alert">{{data.error}}</div>
    <template v-else-if="data.data">
      <div :class="s.tableWrap"><table :class="s.table"><thead><tr><th v-for="label in [say('账号 / 编号','Account / ID'),say('类型','Type'),say('状态','Status'),props.kind==='orders'?say('金额 CNY','Amount CNY'):say('时长','Duration'),say('创建时间','Created')]" :key="label">{{label}}</th></tr></thead><tbody><tr v-for="row in data.data.items" :key="row.id"><td>{{row.username}}<code>{{row.id}}</code></td><td>{{sceneName(row.scene,say)}}<small v-if="row.title">{{row.title}}</small></td><td><span :class="s.badge">{{stateName(row.state,say)}}</span></td><td>{{props.kind==='orders'?amount(row):duration(row)}}</td><td>{{new Date(row.createdAt).toLocaleString(intlLocale)}}</td></tr></tbody></table></div>
      <p v-if="!data.data.items.length" :class="s.empty">{{say('暂无匹配记录','No matching records')}}</p>
      <AdminPager :page="data.data.page" :pages="data.data.pages" :total="data.data.total" @change="page=$event"/>
    </template>
  </section>
</template>
