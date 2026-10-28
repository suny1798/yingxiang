<script setup lang="ts">
import { computed } from 'vue';
import type { AdminTab } from './admin';
import { useAdminConsole,useSay } from './use-admin-console';
import AdminOverview from './AdminOverview.vue';
import AdminUsers from './AdminUsers.vue';
import AdminRecords from './AdminRecords.vue';
import AdminSettings from './AdminSettings.vue';
import AdminAudit from './AdminAudit.vue';
import AdminConfirm from './AdminConfirm.vue';
import s from '../components/site/admin.module.css';
defineProps<{username:string}>();
const say=useSay();
const {state,admin}=useAdminConsole();
const tabs=computed<Array<[AdminTab,string]>>(()=>[['overview',say('项目总览','Overview')],['users',say('用户与权益','Users & access')],['usage',say('实时使用记录','Live usage')],['video',say('视频任务','Video tasks')],['orders',say('沙盒订单','Sandbox orders')],['settings',say('服务与内容','Services & content')],['audit',say('操作日志','Audit log')]]);
const recordsTab=computed(()=>state.value.tab==='usage'||state.value.tab==='video'||state.value.tab==='orders'?state.value.tab:null);
</script>
<template>
  <main :class="s.page">
    <header :class="s.heading"><div><p>{{say('映想 · 项目管理','Yingxiang · Administration')}}</p><h1>{{say('管理后台','Admin console')}}</h1></div><div :class="s.toolbar"><p><span>{{username}}</span> · {{say('管理员','Administrator')}}</p><button type="button" :class="s.button" :disabled="state.busy" @click="admin.refresh()">{{say('刷新数据','Refresh data')}}</button></div></header>
    <section v-if="state.denied" :class="s.panel"><h2>{{say('管理权限已失效','Administrator access has ended')}}</h2><p>{{say('请重新登录并核对账号权限。管理数据已隐藏。','Sign in again and check your access. Administrative data is hidden.')}}</p></section>
    <div v-else :class="s.layout">
      <nav :class="s.nav" :aria-label="say('后台导航','Admin navigation')"><button v-for="[key,label] in tabs" :key="key" type="button" :aria-pressed="state.tab===key" :disabled="state.busy" @click="admin.select(key)">{{label}}</button></nav>
      <div>
        <div v-if="state.error&&!state.pending" :class="s.error" role="alert">{{state.error}}</div>
        <AdminOverview v-if="state.tab==='overview'" :revision="state.revision"/>
        <AdminUsers v-else-if="state.tab==='users'" :revision="state.revision" @prepare="admin.prepare($event)"/>
        <AdminRecords v-else-if="recordsTab" :key="recordsTab" :kind="recordsTab" :revision="state.revision"/>
        <AdminSettings v-else-if="state.tab==='settings'" :revision="state.revision" @prepare="admin.prepare($event)"/>
        <AdminAudit v-else-if="state.tab==='audit'" :revision="state.revision"/>
      </div>
    </div>
    <AdminConfirm v-if="state.pending" :pending="state.pending" :busy="state.busy" :error="state.error" @close="admin.close()" @save="admin.save()"/>
  </main>
</template>
