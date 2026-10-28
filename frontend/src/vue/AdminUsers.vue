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
const quotaSeconds=ref<15|30|60>(15),delta=ref(1),quotaReason=ref('');
watch(()=>props.revision,()=>{selected.value=null;});
watch(selected,user=>{
  if(!user)return;
  role.value=user.role;disabled.value=user.disabled;reason.value='';
  quotaSeconds.value=15;delta.value=1;quotaReason.value='';
  void Promise.resolve().then(()=>editor.value?.focus());
});
function search(value:string){query.value=value;page.value=1;selected.value=null;}
function date(value:string){return new Date(value).toLocaleDateString(intlLocale.value);}
function roleSubmit(){
  const user=selected.value;if(!user)return;
  const text=reason.value.trim();
  emit('prepare',{path:`/api/admin/users/${user.id}`,body:{role:role.value,disabled:disabled.value,reason:text},summary:`${user.username}\n${say('角色','Role')}: ${role.value}\n${disabled.value?say('暂停账号并撤销会话','Suspend account and revoke sessions'):say('账号正常','Account active')}\n${text}`});
}
function quotaSubmit(){
  const user=selected.value;if(!user)return;
  const text=quotaReason.value.trim();
  emit('prepare',{path:`/api/admin/users/${user.id}/quota`,body:{seconds:quotaSeconds.value,delta:delta.value,reason:text},summary:`${user.username}\n${quotaSeconds.value}s · ${delta.value>0?'+':''}${delta.value} ${say('次实时换装体验','live try-on sessions')}\n${text}`});
}
</script>
<template>
  <section :class="s.panel">
    <h2>{{say('用户与体验权益','Users & trial entitlements')}}</h2>
    <AdminSearch @submit="search"/>
    <div v-if="state.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
    <div v-else-if="state.error" :class="s.error" role="alert">{{state.error}}</div>
    <template v-else-if="state.data">
      <div :class="s.tableWrap"><table :class="s.table"><thead><tr><th v-for="label in [say('账号','Account'),say('角色 / 状态','Role / status'),say('可用体验次数','Available sessions'),say('操作','Actions')]" :key="label">{{label}}</th></tr></thead><tbody><tr v-for="user in state.data.items" :key="user.id"><td>{{user.username}}<small>{{date(user.createdAt)}}</small></td><td><span :class="s.badge">{{user.role==='admin'?say('管理员','Admin'):say('普通用户','User')}}</span><small>{{user.disabled?say('已暂停','Suspended'):say('正常','Active')}}</small></td><td><div v-for="item in user.durations" :key="item.seconds">{{item.seconds}}s：{{item.remaining.toLocaleString(intlLocale)}} / {{item.limit.toLocaleString(intlLocale)}}</div></td><td><button :class="s.button" type="button" @click="selected=user">{{say('管理','Manage')}}</button></td></tr></tbody></table></div>
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
      <form :class="s.stack" @submit.prevent="quotaSubmit">
        <h3>{{say('调整实时换装次数','Adjust live try-on sessions')}}</h3>
        <div :class="s.grid"><label :class="s.field">{{say('时长','Duration')}}<select v-model="quotaSeconds"><option v-for="seconds in [15,30,60]" :key="seconds" :value="seconds">{{seconds}}s</option></select></label><label :class="s.field">{{say('增减次数','Change in sessions')}}<input v-model.number="delta" name="delta" type="number" required min="-1000000" max="1000000" step="1"/></label></div>
        <p :class="s.muted">{{say('正数增加，负数回收未用次数。不能修改已用或预留记录；不会提高视频/编辑预算、改变测试名单或把沙盒积分转成真实权益。','Positive values grant sessions; negative values reclaim unused sessions. Used and reserved sessions stay intact. Video/editing budgets, test access lists, and sandbox isolation do not change.')}}</p>
        <label :class="s.field">{{say('操作原因（必填）','Reason (required)')}}<input v-model="quotaReason" required minlength="3" maxlength="200" :placeholder="say('至少3字，不填写密码或密钥','At least 3 characters. Do not include credentials.')"/></label>
        <button :class="s.primary" type="submit">{{say('核对权益调整','Review entitlement changes')}}</button>
      </form>
    </div>
  </section>
</template>
