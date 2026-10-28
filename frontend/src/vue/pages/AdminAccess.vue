<script setup lang="ts">
import { useAccountView } from '../use-account';
import { sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import s from '../../components/site/admin.module.css';
const {snapshot,refresh}=useAccountView();
const say=(zh:string,en:string)=>preferences.locale.value==='en'?en:zh;
</script>
<template>
  <main :class="s.page">
    <template v-if="!snapshot.account"><section v-if="snapshot.error" :class="s.panel"><p role="alert">{{t(snapshot.error)}}</p><button type="button" :class="s.button" @click="refresh">{{say('重新核验','Check again')}}</button></section><p v-else :class="s.empty">{{say('正在核验管理员身份…','Checking administrator access…')}}</p></template>
    <section v-else-if="snapshot.account.user?.role!=='admin'" :class="s.panel"><h1>{{say('这里需要管理员权限','Administrator access required')}}</h1><p :class="s.muted">{{say('此页面仅供项目管理员使用。普通账号无法读取或修改管理数据。','Only project administrators can use this page. Regular accounts cannot read or change administrative data.')}}</p><div :class="s.toolbar"><button v-if="!snapshot.account.user" type="button" :class="s.primary" @click="sessionScope.state.loginOpen=true">{{say('登录账号','Sign in')}}</button><RouterLink to="/" :class="s.button">{{say('返回首页','Back to home')}}</RouterLink></div></section>
    <!-- 管理控制台具体行为由M09迁移；不能把身份门禁当控制台已完成。 -->
    <section v-else :class="s.panel"><h1>{{say('管理页面暂不可用','Management page unavailable')}}</h1><p :class="s.muted">{{say('请稍后重试。','Please try again later.')}}</p><RouterLink to="/account" :class="s.button">{{say('个人中心','My account')}}</RouterLink></section>
  </main>
</template>
