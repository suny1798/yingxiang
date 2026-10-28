<script setup lang="ts">
import { computed,ref,toRef } from 'vue';
import type { AuditPage } from '../lib/api-schema';
import { preferences } from './preferences';
import { useAdminData,useSay } from './use-admin-console';
import AdminPager from './AdminPager.vue';
import s from '../components/site/admin.module.css';
const props=defineProps<{revision:number}>();
const say=useSay();
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const page=ref(1);
const data=useAdminData<AuditPage>(()=>`/api/admin/audit?page=${page.value}`,toRef(props,'revision'));
const created=(value:string)=>new Date(value).toLocaleString(intlLocale.value);
</script>
<template>
  <section :class="s.panel">
    <h2>{{say('管理操作日志','Administrative audit log')}}</h2>
    <p :class="s.muted">{{say('记录操作者、对象、原因与修改前后值。日志不可在网页删除或改写。','Records the actor, target, reason, and before/after values. Logs cannot be deleted or rewritten from this console.')}}</p>
    <div v-if="data.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
    <div v-else-if="data.error" :class="s.error" role="alert">{{data.error}}</div>
    <template v-else-if="data.data">
      <div :class="s.tableWrap"><table :class="s.table"><thead><tr><th v-for="label in [say('操作 / 时间','Action / time'),say('操作者','Actor'),say('对象','Target'),say('原因与变化','Reason & changes')]" :key="label">{{label}}</th></tr></thead><tbody><tr v-for="row in data.data.items" :key="row.id"><td>{{row.action}}<small>{{created(row.createdAt)}}</small></td><td>{{row.actor}}</td><td><code>{{row.target}}</code></td><td>{{row.reason}}<details><summary>{{say('查看变化','View changes')}}</summary><pre>{{row.changes}}</pre></details></td></tr></tbody></table></div>
      <p v-if="!data.data.items.length" :class="s.empty">{{say('暂无操作','No actions yet')}}</p>
      <AdminPager :page="data.data.page" :pages="data.data.pages" :total="data.data.total" @change="page=$event"/>
    </template>
  </section>
</template>
