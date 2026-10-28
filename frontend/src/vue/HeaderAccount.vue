<script setup lang="ts">
import { computed,ref,nextTick,watch,onMounted,onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAccountView } from './use-account';
import { accountCoordinator,sessionScope } from './runtime';
import { notify } from '../lib/notices';
import { t } from './preferences';
import s from '../components/site/site.module.css';
const {snapshot,refresh}=useAccountView();const route=useRoute();
const account=computed(()=>snapshot.value.account);
const open=ref(false),closing=ref(false),position=ref<{left:number;top:number;caret:number}|null>(null);
const menu=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null);
let timer:ReturnType<typeof setTimeout>|undefined;
const links=[['/account','个人中心'],['/account/usage','使用记录'],['/account/orders','我的订单'],['/account/security','账号设置']];
function close(animate=true){open.value=false;clearTimeout(timer);closing.value=animate;if(animate)timer=setTimeout(()=>{closing.value=false;},160);}
function toggle(){if(open.value){close();return;}clearTimeout(timer);closing.value=false;open.value=true;}
function place(){if(!open.value||!menu.value||!trigger.value)return;const wrapper=menu.value.getBoundingClientRect(),rect=trigger.value.getBoundingClientRect(),width=Math.min(210,innerWidth-28),center=rect.left+rect.width/2,left=Math.min(Math.max(14,center-width/2),innerWidth-width-14);position.value={left:left-wrapper.left,top:rect.bottom-wrapper.top+12,caret:center-left-5};}
function outside(event:PointerEvent){if(open.value&&!menu.value?.contains(event.target as Node))close();}
function escape(event:KeyboardEvent){if(open.value&&event.key==='Escape'){close();trigger.value?.focus();}}
function scroll(){if(open.value)close(false);}
function retry(){if(sessionScope.state.blocked)window.location.reload();else void refresh();}
async function logout(){try{await accountCoordinator.logout();close(false);notify('已退出登录。','success');}catch{notify('退出未完成，请稍后再试。','error');}}
watch(open,async value=>{if(value){await nextTick();place();}});
watch(()=>route.path,()=>close(false));watch(()=>account.value?.user?.id,()=>close(false));
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',place);window.addEventListener('scroll',scroll,{passive:true});});
onUnmounted(()=>{clearTimeout(timer);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll);});
</script>
<template>
  <button v-if="!account&&snapshot.error" type="button" :class="s.loginButton" @click="retry">{{t(sessionScope.state.blocked?'刷新页面':'重新读取账号')}}</button>
  <span v-else-if="!account" :class="s.accountPending" role="status" :aria-label="t('正在读取账号')">{{t(snapshot.busy?'正在处理…':'账号读取中…')}}</span>
  <div v-else-if="account.user" ref="menu" :class="s.accountMenu">
    <button ref="trigger" type="button" :class="[s.accountLink,s.accountTrigger]" :aria-label="t('账号菜单')" :aria-expanded="open" aria-controls="site-account-nav" @click="toggle"><span :class="s.avatarDot">{{account.user.username.charAt(0).toUpperCase()}}</span><span>{{t('个人中心')}}</span><span :class="s.chevron" aria-hidden="true"><svg viewBox="0 0 12 8" fill="none"><path d="M1.5 1.5 6 6l4.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>
    <div v-if="(open||closing)&&position" :class="[s.accountPopover,{[s.accountPopoverClosing]:closing}]" :style="{left:position.left+'px',top:position.top+'px','--caret-left':position.caret+'px'}" :aria-hidden="closing||undefined" :inert="closing">
      <nav id="site-account-nav" :class="s.accountNav" :aria-label="t('账号导航')"><RouterLink v-for="[path,label] in links" :key="path" :to="path" :aria-label="t(label!)" :aria-current="route.path===path?'page':undefined" :class="s.accountItem" @click="close(false)"><span :class="s.accountItemText"><strong>{{t(label!)}}</strong></span><span :class="s.accountItemArrow" aria-hidden="true">↗</span></RouterLink></nav>
      <button type="button" :class="s.accountSignout" :disabled="snapshot.busy" @click="logout">{{t(snapshot.busy?'正在退出…':'退出登录')}}<span aria-hidden="true">→</span></button>
    </div>
  </div>
  <button v-else type="button" :class="s.loginButton" @click="sessionScope.state.loginOpen=true">{{t('登录 / 注册')}}</button>
</template>
