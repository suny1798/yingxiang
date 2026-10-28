<script setup lang="ts">
import { ref,toRef,watch } from 'vue';
import type { AdminSettings } from '../lib/api-schema';
import type { AdminPending } from './admin';
import { sceneName } from './admin-labels';
import { useAdminData,useSay } from './use-admin-console';
import s from '../components/site/admin.module.css';
const props=defineProps<{revision:number}>();
const emit=defineEmits<{prepare:[pending:AdminPending]}>();
const say=useSay();
const state=useAdminData<AdminSettings>(()=>'/api/admin/settings',toRef(props,'revision'));
const pausedStudio=ref(false),pausedVideo=ref(false),pausedPrompt=ref(false),servicesReason=ref('');
const enabled=ref(false),zh=ref(''),en=ref(''),announcementReason=ref('');
watch(state,value=>{
  const data=value.data;if(!data)return;
  pausedStudio.value=data.services.studio;pausedVideo.value=data.services.video;pausedPrompt.value=data.services.prompt;
  enabled.value=data.announcement.enabled;zh.value=data.announcement.zh;en.value=data.announcement.en;
},{deep:true});
function servicesSubmit(){
  const data=state.value.data;if(!data)return;
  const paused={studio:pausedStudio.value,video:pausedVideo.value,prompt:pausedPrompt.value};
  const summary=Object.entries(paused).map(([key,value])=>`${sceneName(key,say)}: ${value?say('暂停新生成','Pause new requests'):say('按原配置运行','Use existing configuration')}`).join('\n');
  emit('prepare',{path:'/api/admin/settings/services',body:{version:data.services.version,paused,reason:servicesReason.value.trim()},summary});
}
function announcementSubmit(){
  const data=state.value.data;if(!data)return;
  emit('prepare',{path:'/api/admin/settings/announcement',body:{version:data.announcement.version,enabled:enabled.value,zh:zh.value.trim(),en:en.value.trim(),reason:announcementReason.value.trim()},summary:`${enabled.value?say('发布全站公告','Publish site announcement'):say('关闭全站公告','Disable site announcement')}\n${zh.value.trim()}\n${en.value.trim()}`});
}
</script>
<template>
  <div v-if="state.loading" :class="s.panel" role="status">{{say('正在读取…','Loading…')}}</div>
  <div v-else-if="state.error" :class="s.error" role="alert">{{state.error}}</div>
  <div v-else-if="state.data" :class="s.stack">
    <section :class="s.panel"><h2>{{say('暂停新生成','Pause new generation')}}</h2><div :class="s.notice">{{say('这是现有服务配置之上的暂停开关。取消暂停仅恢复原配置，不启用原本关闭的功能，不改变预算或取消在途任务。','These pause controls sit above existing configuration. Resuming only restores that configuration; it does not enable disabled features, alter budgets, or cancel in-flight tasks.')}}</div>
      <form :class="s.stack" @submit.prevent="servicesSubmit">
        <div :class="s.toolbar"><label :class="s.check"><input v-model="pausedStudio" type="checkbox"/>{{sceneName('studio',say)}}</label><label :class="s.check"><input v-model="pausedVideo" type="checkbox"/>{{sceneName('video',say)}}</label><label :class="s.check"><input v-model="pausedPrompt" type="checkbox"/>{{sceneName('prompt',say)}}</label></div>
        <label :class="s.field">{{say('操作原因（必填）','Reason (required)')}}<input v-model="servicesReason" required minlength="3" maxlength="200" :placeholder="say('至少3字，不填写密码或密钥','At least 3 characters. Do not include credentials.')"/></label>
        <div><button :class="s.primary" type="submit">{{say('核对服务修改','Review service changes')}}</button></div>
      </form>
    </section>
    <section :class="s.panel"><h2>{{say('站点公告','Site announcement')}}</h2><p :class="s.muted">{{say('用于维护或内测通知，在全站左下角展示，可由用户关闭。仅显示纯文本；未发布的内容不会公开。','Maintenance and test notices appear in the lower-left corner across the site and can be dismissed. Plain text only. Unpublished content stays private.')}}</p>
      <form :class="s.stack" @submit.prevent="announcementSubmit">
        <label :class="s.check"><input v-model="enabled" type="checkbox"/>{{say('展示公告','Show announcement')}}</label>
        <div :class="s.grid"><label :class="s.field">{{say('中文正文','Chinese text')}}<textarea v-model="zh" maxlength="240"/></label><label :class="s.field">{{say('英文正文','English text')}}<textarea v-model="en" maxlength="400"/></label></div>
        <label :class="s.field">{{say('操作原因（必填）','Reason (required)')}}<input v-model="announcementReason" required minlength="3" maxlength="200" :placeholder="say('至少3字，不填写密码或密钥','At least 3 characters. Do not include credentials.')"/></label>
        <div><button :class="s.primary" type="submit">{{say('核对公告修改','Review announcement changes')}}</button></div>
      </form>
    </section>
    <section :class="s.panel"><h2>{{say('页面与商品内容','Pages & products')}}</h2><p :class="s.muted">{{say('当前体量下，首页、帮助、协议及套餐价格随代码版本维护，避免网站文案、支付金额与权益规则各有一套。后台不提供任意代码、HTML、SQL 或密钥编辑器；后续频繁运营的内容再逐项接入。','At this project size, home, help, terms, and package prices stay versioned with code so copy, checkout amounts, and entitlement rules remain consistent. The console does not provide arbitrary code, HTML, SQL, or secret editors. Frequently operated content can be added individually as needed.')}}</p><div :class="s.toolbar"><RouterLink :class="s.button" to="/help">{{say('帮助中心','Help')}}</RouterLink><RouterLink :class="s.button" to="/terms">{{say('用户协议','Terms')}}</RouterLink><RouterLink :class="s.button" to="/pricing">{{say('价格方案','Pricing')}}</RouterLink></div></section>
  </div>
</template>
