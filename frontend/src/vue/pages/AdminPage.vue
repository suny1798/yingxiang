<script setup lang="ts">
import { useAccountView } from '../use-account';
import { sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import AdminConsole from '../AdminConsole.vue';
import s from '../../components/site/admin.module.css';
const {snapshot,refresh}=useAccountView();
const say=(zh:string,en:string)=>preferences.locale.value==='en'?en:zh;
</script>
<template>
  <main v-if="!snapshot.account" :class="s.page">
    <section v-if="snapshot.error" :class="s.panel"><p role="alert">{{t(snapshot.error)}}</p><button type="button" :class="s.button" @click="refresh">{{say('重新核验','Check again')}}</button></section>
    <p v-else :class="s.empty">{{say('正在核验管理员身份…','Checking administrator access…')}}</p>
  </main>
  <main v-else-if="snapshot.account.user?.role!=='admin'" :class="s.page">
    <section :class="s.panel"><h1>{{say('这里需要管理员权限','Administrator access required')}}</h1><p :class="s.muted">{{say('此页面仅供项目管理员使用。普通账号无法读取或修改管理数据。','Only project administrators can use this page. Regular accounts cannot read or change administrative data.')}}</p><div :class="s.toolbar"><button v-if="!snapshot.account.user" type="button" :class="s.primary" @click="sessionScope.state.loginOpen=true">{{say('登录账号','Sign in')}}</button><RouterLink to="/" :class="s.button">{{say('返回首页','Back to home')}}</RouterLink></div></section>
  </main>
  <AdminConsole v-else :username="snapshot.account.user.username"/>
</template>
