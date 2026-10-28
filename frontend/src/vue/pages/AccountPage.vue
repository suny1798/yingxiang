<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { useAccountView } from '../use-account';
import { accountCoordinator,sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import { durationLabel } from '../../lib/studio/policy';
import { notify } from '../../lib/notices';
import OrdersPanel from '../OrdersPanel.vue';
import s from '../../components/site/site.module.css';
defineProps<{section:'overview'|'usage'|'orders'|'security'}>();
const {snapshot,refresh}=useAccountView();const account=computed(()=>snapshot.value.account),actionError=ref('');
const remaining=computed(()=>account.value?.trialRemaining??0),trial=computed(()=>remaining.value>0),review=computed(()=>account.value?.trial==='review');
const longDurations=computed(()=>account.value?.durations.filter(item=>item.seconds!==15)??[]),longRemaining=computed(()=>longDurations.value.reduce((sum,item)=>sum+item.remaining,0));
const nav=[['overview','/account','权益概览'],['usage','/account/usage','使用记录'],['orders','/account/orders','我的订单'],['security','/account/security','账号信息']];
function openLogin(){sessionScope.state.loginOpen=true;}
function retry(){if(sessionScope.state.blocked)window.location.reload();else void refresh();}
watch(()=>account.value?.user?.id,()=>{actionError.value='';});
function date(value:string,time=false){return new Intl.DateTimeFormat(preferences.locale.value==='en'?'en-US':'zh-CN',{timeZone:'Asia/Shanghai',...(time?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'} as const:{})}).format(new Date(value));}
async function logout(){actionError.value='';try{await accountCoordinator.logout();}catch{actionError.value='退出未完成，请重试。';notify(actionError.value,'error');}}
</script>
<template>
  <main v-if="!account||snapshot.error" :class="[s.container,s.accountGate]"><p :class="s.eyebrow">{{t('映想 · 个人中心')}}</p><h1>{{t(snapshot.error?'账号信息读取失败。':'正在读取账号信息…')}}</h1><template v-if="snapshot.error"><p>{{t(snapshot.error)}}</p><button type="button" :class="s.outline" @click="retry">{{t(sessionScope.state.blocked?'刷新页面':'重新读取')}}</button></template></main>
  <main v-else-if="!account.user" :class="[s.container,s.accountGate]"><span :class="s.gateStar" aria-hidden="true">✳</span><p :class="s.eyebrow">{{t('映想 · 个人中心')}}</p><h1>{{t('登录后查看')}}<br/><span>{{t('账号与权益。')}}</span></h1><p>{{t('可查看免费权益、使用记录、订单与账号信息。')}}<br/>{{t('未登录也可以先进入创作空间预览素材。')}}</p><div :class="s.gateActions"><button type="button" :class="s.primary" @click="openLogin">{{t('登录账号 ')}}<span aria-hidden="true">↗</span></button><RouterLink to="/studio" :class="s.textLink">{{t('进入创作空间 →')}}</RouterLink></div></main>
  <main v-else :class="[s.container,s.accountLayout]">
    <aside :class="s.accountSidebar"><p :class="s.eyebrow">{{t('账号中心')}}</p><h1>{{t('个人中心')}}</h1><nav :aria-label="t('个人中心导航')"><RouterLink v-for="[key,path,label] in nav" :key="key" :to="path" :class="{[s.accountNavActive]:key===section}" :aria-current="key===section?'page':undefined">{{t(label!)}}<span v-if="key===section" aria-hidden="true">↗</span></RouterLink></nav><p>{{t('账号、权益')}}<br/>{{t('与使用记录')}}</p></aside>
    <div :class="s.accountMain">
      <template v-if="section==='overview'">
        <section :class="s.accountWelcome"><div><p :class="s.eyebrow">{{t('账号概览')}}</p><h2>{{t('你好，')}}{{account.user.username}}<span>。</span></h2><p>{{t(trial?account.history.length?`当前剩余 ${remaining} 次免费体验。`:'免费体验尚未使用，可在创作空间开始实时换装。':review?'上次连接状态待核查，请联系项目维护者确认。':'免费体验已使用，可查看使用记录或了解积分方案。')}}</p></div><span :class="s.largeAvatar" aria-hidden="true">{{account.user.username.charAt(0).toUpperCase()}}</span></section>
        <section :class="s.accountBenefits" :aria-label="t('我的权益')"><div :class="s.trialBenefit"><div :class="s.quoteTop"><span>{{t('免费体验')}}</span><span>{{t(trial?'待使用':review?'待核查':'已使用')}}</span></div><strong>{{remaining}}<span>{{t('次免费体验')}}</span></strong><p>{{t('共 ')}}{{account.trialLimit}} {{t(' 次，每次最多15秒，生成画面开始播放后计时。')}}</p><span v-if="!trial" :class="s.benefitNote">{{t(review?'不自动重试，请联系开发者核查。':`免费权益共 ${account.trialLimit} 次。`)}}</span></div>
          <div :class="s.paidBenefit"><div :class="s.quoteTop"><span>{{t('长时权益')}}</span><span>{{t(longRemaining?'已发放':'购买暂未开放')}}</span></div><strong>{{longRemaining}}<span>{{t('次可用体验')}}</span></strong><p>{{longDurations.map(item=>t(`${durationLabel(item.seconds)} · ${item.remaining}次`)).join(' / ')}}</p><RouterLink v-if="longRemaining" to="/studio">{{t('去使用对应时长 ↗')}}</RouterLink><RouterLink v-else to="/pricing">{{t('查看拟定价格 ↗')}}</RouterLink></div></section>
      </template>
      <section v-if="section==='usage'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('使用记录')}}</h2><span>{{t('最近20条 · 北京时间')}}</span></div><div v-if="account.history.length" :class="s.historyTable"><table><thead><tr><th>{{t('体验内容')}}</th><th>{{t('时间')}}</th><th>{{t('状态')}}</th></tr></thead><tbody><tr v-for="item in account.history" :key="item.id"><td>{{t('实时换装 ')}}<small>{{t(durationLabel(item.durationSec))}}{{t('体验')}}</small></td><td><time :datetime="item.createdAt">{{date(item.createdAt,true)}}</time></td><td><span :class="s.statusPill">{{t(item.state==='review'?'待核查':item.outcome==='ended'?'已结束':item.outcome==='error'?'连接异常':'已申请连接')}}</span></td></tr></tbody></table></div><div v-else :class="s.emptyState"><span aria-hidden="true">↗</span><h3>{{t('暂无使用记录')}}</h3><p>{{t('选择服装并开始实时换装后，这里会记录使用状态。')}}</p><RouterLink to="/studio" :class="s.textLink">{{t('进入创作空间 →')}}</RouterLink></div></section>
      <section v-if="section==='orders'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('我的订单')}}</h2><RouterLink to="/pricing">{{t('查看价格 →')}}</RouterLink></div><OrdersPanel/></section>
      <section v-if="section==='security'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('账号信息')}}</h2><span>{{t('账号密码登录')}}</span></div><dl :class="s.accountDetails"><div><dt>{{t('账号')}}</dt><dd>{{account.user.username}}</dd></div><div><dt>{{t('注册日期')}}</dt><dd>{{date(account.user.createdAt)}}</dd></div><div><dt>{{t('手机号验证')}}</dt><dd>{{t('暂未开放')}}</dd></div><div><dt>{{t('密码管理')}}</dt><dd>{{t('暂不支持找回，请妥善保存密码。')}}</dd></div></dl><div :class="s.accountSignout"><span>{{t('生成视频与服装参考图保存到我的作品；相机原画和输入人物视频不保存。')}}</span><button type="button" :disabled="snapshot.busy" @click="logout">{{t(snapshot.busy?'正在退出…':'退出登录')}}</button></div><p v-if="actionError" role="alert" :class="s.inlineError">{{t(actionError)}}</p></section>
    </div>
  </main>
</template>
