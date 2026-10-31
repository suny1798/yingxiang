<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { useAccountView } from '../use-account';
import { accountCoordinator,sessionScope } from '../runtime';
import { preferences,t } from '../preferences';
import type { HistoryView } from '../../lib/api-schema';
import { notify } from '../../lib/notices';
import OrdersPanel from '../OrdersPanel.vue';
import WalletPanel from '../WalletPanel.vue';
import s from '../../components/site/site.module.css';
defineProps<{section:'overview'|'usage'|'orders'|'security'}>();
const {snapshot,refresh}=useAccountView();const account=computed(()=>snapshot.value.account),actionError=ref('');
const remaining=computed(()=>account.value?.trialRemaining??0),trial=computed(()=>remaining.value>0);
const videoTrial=computed(()=>account.value?.videoTrial);
const hasVideoTrial=computed(()=>Boolean(videoTrial.value?.enabled&&videoTrial.value.remaining>0));
const nav=[['overview','/account','权益概览'],['usage','/account/usage','使用记录'],['orders','/account/orders','我的订单'],['security','/account/security','账号信息']];
function openLogin(){sessionScope.state.loginOpen=true;}
function retry(){if(sessionScope.state.blocked)window.location.reload();else void refresh();}
watch(()=>account.value?.user?.id,()=>{actionError.value='';});
function date(value:string,time=false){return new Intl.DateTimeFormat(preferences.locale.value==='en'?'en-US':'zh-CN',{timeZone:'Asia/Shanghai',...(time?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'} as const:{})}).format(new Date(value));}
const historyKinds={realtime:'实时换装',video:'视频换装',edit:'实时编辑'} as const;
function historyDuration(item:HistoryView){return `${item.durationSec.toFixed(2)} ${t('秒')}`;}
function historyStatus(item:HistoryView){if(item.status==='review')return '待核查';if(item.status==='processing')return '生成中';if(item.status==='completed')return '已完成';if(item.status==='ended')return '已结束';if(item.status==='error')return item.kind==='video'?'未完成':'连接异常';return '已申请连接';}
async function logout(){actionError.value='';try{await accountCoordinator.logout();}catch{actionError.value='退出未完成，请重试。';notify(actionError.value,'error');}}
</script>
<template>
  <main v-if="!account||snapshot.error" :class="[s.container,s.accountGate]"><p :class="s.eyebrow">{{t('映想 · 个人中心')}}</p><h1>{{t(snapshot.error?'账号信息读取失败。':'正在读取账号信息…')}}</h1><template v-if="snapshot.error"><p>{{t(snapshot.error)}}</p><button type="button" :class="s.outline" @click="retry">{{t(sessionScope.state.blocked?'刷新页面':'重新读取')}}</button></template></main>
  <main v-else-if="!account.user" :class="[s.container,s.accountGate]"><span :class="s.gateStar" aria-hidden="true">✳</span><p :class="s.eyebrow">{{t('映想 · 个人中心')}}</p><h1>{{t('登录后查看')}}<br/><span>{{t('账号与权益。')}}</span></h1><p>{{t('可查看免费权益、使用记录、订单与账号信息。')}}<br/>{{t('未登录也可以先进入创作空间预览素材。')}}</p><div :class="s.gateActions"><button type="button" :class="s.primary" @click="openLogin">{{t('登录账号 ')}}<span aria-hidden="true">↗</span></button><RouterLink to="/studio" :class="s.textLink">{{t('进入创作空间 →')}}</RouterLink></div></main>
  <main v-else :class="[s.container,s.accountLayout]">
    <aside :class="s.accountSidebar"><p :class="s.eyebrow">{{t('账号中心')}}</p><h1>{{t('个人中心')}}</h1><nav :aria-label="t('个人中心导航')"><RouterLink v-for="[key,path,label] in nav" :key="key" :to="path" :class="{[s.accountNavActive]:key===section}" :aria-current="key===section?'page':undefined">{{t(label!)}}<span v-if="key===section" aria-hidden="true">↗</span></RouterLink></nav><p>{{t('账号、权益')}}<br/>{{t('与使用记录')}}</p></aside>
    <div :class="s.accountMain">
      <WalletPanel v-if="section==='overview'||section==='usage'||section==='orders'" :user-id="account.user.id" :show-history="section==='usage'"/>
      <template v-if="section==='overview'">
        <section :class="s.accountWelcome"><div><p :class="s.eyebrow">{{t('账号概览')}}</p><h2>{{t('你好，')}}{{account.user.username}}<span>。</span></h2><p>{{t('查看积分、使用记录与账号信息。')}}</p></div><span :class="s.largeAvatar" aria-hidden="true">{{account.user.username.charAt(0).toUpperCase()}}</span></section>
        <section v-if="trial||hasVideoTrial" :class="s.accountBenefits" :aria-label="t('免费体验')">
          <div v-if="trial" :class="s.trialBenefit"><div :class="s.quoteTop"><span>{{t('实时换装免费体验')}}</span><span>{{t('待使用')}}</span></div><strong>{{remaining}}<span>{{t('次免费体验')}}</span></strong><p>{{t('每个新账号1次，每次最多15秒，从生成画面播放后计时。')}}</p><span v-if="account.studioTestAccess" :class="s.benefitNote">{{t('当前账号另有手动测试权限。')}}</span><RouterLink to="/studio" :class="s.trialAction" :aria-label="t('去使用实时换装免费体验')">{{t('去使用')}} <span aria-hidden="true">↗</span></RouterLink></div>
          <div v-if="hasVideoTrial" :class="s.trialBenefit"><div :class="s.quoteTop"><span>{{t('视频换装免费体验')}}</span><span>{{t('待使用')}}</span></div><strong>{{videoTrial?videoTrial.remaining:'—'}}<span>{{t('次免费体验')}}</span></strong><p>{{t('每个新账号1次，可上传1—10秒的人物视频。')}}</p><span v-if="videoTrial?.unlimited" :class="s.benefitNote">{{t('当前账号另有手动测试权限。')}}</span><RouterLink to="/studio/video" :class="s.trialAction" :aria-label="t('去使用视频换装免费体验')">{{t('去使用')}} <span aria-hidden="true">↗</span></RouterLink></div>
        </section>
      </template>
      <section v-if="section==='usage'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('使用记录')}}</h2><span>{{t('最近20条 · 北京时间')}}</span></div><p v-if="account.history.length" :class="s.usageNote">{{t('时长保留两位小数；积分按核验时长向上取整。未扣积分的记录不产生返还，未核验不代表结果为0秒。')}}</p><div v-if="account.history.length" :class="s.historyTable"><table><thead><tr><th>{{t('创作内容')}}</th><th>{{t('时间')}}</th><th>{{t('时长明细')}}</th><th>{{t('积分明细')}}</th><th>{{t('状态')}}</th></tr></thead><tbody><tr v-for="item in account.history" :key="item.id"><td>{{t(historyKinds[item.kind])}}</td><td><time :datetime="item.createdAt">{{date(item.createdAt,true)}}</time></td><td><div :class="s.usageDetail"><span>{{t(item.kind==='video'?'上传时长':'设定时长')}} <strong>{{historyDuration(item)}}</strong></span><span>{{t('结果时长')}} <strong v-if="item.resultDurationSec!=null">{{item.resultDurationSec.toFixed(2)}} {{t('秒')}}</strong><span v-else>{{t(item.resultPending?'核验中…':'暂未核验')}}</span></span></div></td><td><div v-if="item.billing" :class="s.usageDetail"><span>{{t('预留积分')}} <strong>{{item.billing.reservedCredits}}</strong></span><span>{{t('实际消耗')}} <strong v-if="item.billing.chargedCredits!=null">{{item.billing.chargedCredits}} {{t('积分')}}</strong><span v-else>{{t('待结算')}}</span></span><span>{{t('返还积分')}} <strong v-if="item.billing.returnedCredits!=null">{{item.billing.returnedCredits}}</strong><span v-else>{{t('待结算')}}</span></span></div><span v-else :class="s.usageNoCharge">{{t('未扣积分')}}</span></td><td><span :class="s.statusPill">{{t(historyStatus(item))}}</span></td></tr></tbody></table></div><div v-else :class="s.emptyState"><span aria-hidden="true">↗</span><h3>{{t('暂无使用记录')}}</h3><p>{{t('开始实时换装、视频换装或实时编辑后，这里会记录使用状态。')}}</p><RouterLink to="/studio" :class="s.textLink">{{t('进入创作空间 →')}}</RouterLink></div></section>
      <section v-if="section==='orders'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('我的订单')}}</h2><RouterLink to="/pricing">{{t('查看价格 →')}}</RouterLink></div><OrdersPanel/></section>
      <section v-if="section==='security'" :class="s.accountSection"><div :class="s.cardHeading"><h2>{{t('账号信息')}}</h2><span>{{t('账号密码登录')}}</span></div><dl :class="s.accountDetails"><div><dt>{{t('账号')}}</dt><dd>{{account.user.username}}</dd></div><div><dt>{{t('注册日期')}}</dt><dd>{{date(account.user.createdAt)}}</dd></div><div><dt>{{t('手机号验证')}}</dt><dd>{{t('暂未开放')}}</dd></div><div><dt>{{t('密码管理')}}</dt><dd>{{t('暂不支持找回，请妥善保存密码。')}}</dd></div></dl><div :class="s.accountSignout"><span>{{t('生成视频与服装参考图保存到我的作品；相机原画和输入人物视频不保存。')}}</span><button type="button" :disabled="snapshot.busy" @click="logout">{{t(snapshot.busy?'正在退出…':'退出登录')}}</button></div><p v-if="actionError" role="alert" :class="s.inlineError">{{t(actionError)}}</p></section>
    </div>
  </main>
</template>
