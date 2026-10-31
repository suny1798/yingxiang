<script setup lang="ts">
import { computed,ref,toRef,watch } from 'vue';
import type { AdminUser,AdminUsers } from '../lib/api-schema';
import type { AdminPending } from './admin';
import { preferences } from './preferences';
import { useAdminData,useSay } from './use-admin-console';
import AdminPager from './AdminPager.vue';
import AdminSearch from './AdminSearch.vue';
import s from '../components/site/admin.module.css';
const props=defineProps<{revision:number}>();
const emit=defineEmits<{prepare:[pending:AdminPending]}>();
const say=useSay();
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const query=ref(''),page=ref(1),selected=ref<AdminUser|null>(null);
const state=useAdminData<AdminUsers>(()=>`/api/admin/users?q=${encodeURIComponent(query.value)}&page=${page.value}`,toRef(props,'revision'));
const editor=ref<HTMLElement|null>(null);
const role=ref<'user'|'admin'>('user'),disabled=ref(false),reason=ref('');
const creditsDelta=ref(1),creditsReason=ref('');
watch(()=>props.revision,()=>{selected.value=null;});
watch(selected,user=>{
  if(!user)return;
  role.value=user.role;disabled.value=user.disabled;reason.value='';
  creditsDelta.value=1;creditsReason.value='';
  void Promise.resolve().then(()=>editor.value?.focus());
});
function search(value:string){query.value=value;page.value=1;selected.value=null;}
function date(value:string){return new Date(value).toLocaleDateString(intlLocale.value);}
function roleSubmit(){
  const user=selected.value;if(!user)return;
  const text=reason.value.trim();
  emit('prepare',{path:`/api/admin/users/${user.id}`,body:{role:role.value,disabled:disabled.value,reason:text},summary:`${user.username}\n${say('角色','Role')}: ${role.value}\n${disabled.value?say('暂停账号并撤销会话','Suspend account and revoke sessions'):say('账号正常','Account active')}\n${text}`});
}
function creditsSubmit(){
  const user=selected.value;if(!user)return;
  const text=creditsReason.value.trim();
  emit('prepare',{path:`/api/admin/users/${user.id}/credits`,body:{delta:creditsDelta.value,reason:text},summary:`${user.username}\n${creditsDelta.value>0?'+':''}${creditsDelta.value} ${say('积分','credits')}\n${text}`});
}
</script>
<template>
  <section :class="s.panel">
    <h2>{{say('用户与积分','Users & credits')}}</h2>
    <AdminSearch @submit="search"/>
    <div v-if="state.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
    <div v-else-if="state.error" :class="s.error" role="alert">{{state.error}}</div>
    <template v-else-if="state.data">
      <div :class="s.tableWrap"><table :class="s.table"><thead><tr><th v-for="label in [say('账号','Account'),say('角色 / 状态','Role / status'),say('可用积分','Available credits'),say('操作','Actions')]" :key="label">{{label}}</th></tr></thead><tbody><tr v-for="user in state.data.items" :key="user.id"><td>{{user.username}}<small>{{date(user.createdAt)}}</small></td><td><span :class="s.badge">{{user.role==='admin'?say('管理员','Admin'):say('普通用户','User')}}</span><small>{{user.disabled?say('已暂停','Suspended'):say('正常','Active')}}</small></td><td>{{user.credits.toLocaleString(intlLocale)}} {{say('积分','credits')}}</td><td><button :class="s.button" type="button" @click="selected=user">{{say('管理','Manage')}}</button></td></tr></tbody></table></div>
      <p v-if="!state.data.items.length" :class="s.empty">{{say('没有找到账号','No accounts found')}}</p>
      <AdminPager :page="state.data.page" :pages="state.data.pages" :total="state.data.total" @change="page=$event"/>
    </template>
  </section>
  <section v-if="selected" ref="editor" tabindex="-1" :class="s.panel" :aria-label="`${say('管理账号','Manage account')} ${selected.username}`">
    <div :class="s.heading"><h2>{{say('管理账号','Manage account')}} · {{selected.username}}</h2><button :class="s.button" type="button" @click="selected=null">{{say('收起','Close')}}</button></div>
    <div :class="s.grid">
      <form :class="s.stack" @submit.prevent="roleSubmit">
        <h3>{{say('角色与状态','Role & status')}}</h3>
        <label :class="s.field">{{say('角色','Role')}}<select v-model="role"><option value="user">{{say('普通用户','User')}}</option><option value="admin">{{say('管理员','Admin')}}</option></select></label>
        <label :class="s.check"><input v-model="disabled" type="checkbox"/>{{say('暂停此账号','Suspend this account')}}</label>
        <p :class="s.muted">{{say('角色变更会撤销该用户旧会话，需重新登录。不能暂停自己或撤销自己的管理权限。','Role changes revoke the user’s old sessions and require signing in again. You cannot suspend or demote yourself.')}}</p>
        <label :class="s.field">{{say('操作原因（必填）','Reason (required)')}}<input v-model="reason" required minlength="3" maxlength="200" :placeholder="say('至少3字，不填写密码或密钥','At least 3 characters. Do not include credentials.')"/></label>
        <button :class="s.primary" type="submit">{{say('核对账号修改','Review account changes')}}</button>
      </form>
      <form :class="s.stack" @submit.prevent="creditsSubmit">
        <h3>{{say('调整积分','Adjust credits')}}</h3>
        <label :class="s.field">{{say('增减积分','Change in credits')}}<input v-model.number="creditsDelta" name="delta" type="number" required min="-1000000" max="1000000" step="1"/></label>
        <p :class="s.muted">{{say('正数发放积分，负数扣减可用积分，余额不会低于0；只调整真实用量钱包，不影响沙盒积分、视频/编辑预算或测试名单。','Positive values grant credits; negative values deduct available credits and never below zero. Only the real-usage wallet changes; sandbox credits, video/editing budgets, and test access lists are unchanged.')}}</p>
        <label :class="s.field">{{say('操作原因（必填）','Reason (required)')}}<input v-model="creditsReason" required minlength="3" maxlength="200" :placeholder="say('至少3字，不填写密码或密钥','At least 3 characters. Do not include credentials.')"/></label>
        <button :class="s.primary" type="submit">{{say('核对积分调整','Review credit changes')}}</button>
      </form>
    </div>
  </section>
</template>
