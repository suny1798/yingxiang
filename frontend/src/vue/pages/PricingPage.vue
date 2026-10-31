<script setup lang="ts">
import { computed,ref,watch,onMounted } from 'vue';
import { CREATION_SCENES,type CreationPlanId,type CreationScene } from '../../lib/pricing';
import { BILLING,TOPUP_PLANS } from '../../lib/billing';
import { envelopeData } from '../../lib/api-response';
import { t } from '../preferences';
import { useAccountView } from '../use-account';
import { useSandboxCheckout } from '../use-sandbox-checkout';
import PricingConfirmation from '../PricingConfirmation.vue';
import s from '../../components/site/pricing.module.css';
const confirming=ref<CreationPlanId|null>(null);
const sceneKeys=Object.keys(CREATION_SCENES) as CreationScene[];
const {snapshot}=useAccountView();
const {state:checkout,buy,clearError}=useSandboxCheckout();
const account=computed(()=>snapshot.value.account);
const purchasePlan=computed(()=>TOPUP_PLANS.find(plan=>plan.id===confirming.value));
const catalogReady=ref(false);
const walletCheckout=computed(()=>({...checkout.value,enabled:checkout.value.enabled&&catalogReady.value}));
onMounted(async()=>{try{const response=await fetch('/api/billing/catalog',{cache:'no-store'});if(response.ok){const value=envelopeData<{version:string}>(await response.json());catalogReady.value=value.version===BILLING.version;}}catch{/* 服务更新期间保持充值禁用。 */}});
watch(()=>account.value?.user?.id,()=>{confirming.value=null;});
function choose(id:CreationPlanId) {clearError();confirming.value=id;}
function confirm() {const id=confirming.value;if(!id||!catalogReady.value)return;if(!account.value?.user)confirming.value=null;void buy(`credits-v2-${id}`);}
</script>
<template>
  <main data-pricing-page :class="s.page">
    <header :class="s.intro"><h1>{{t('充值与积分')}}</h1></header>
    <section :class="s.plans" :aria-label="t('三档创作套餐')">
      <article v-for="(plan,index) in TOPUP_PLANS" :key="plan.id" :class="s.card" :data-featured="plan.featured">
        <div :class="s.cardTop">
          <svg :class="s.planMark" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path v-if="index>1" d="M15 9V6a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><path v-if="index>0" d="M9 15v-3a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><rect x="4" y="16" width="24" height="24" rx="3"/><path d="M9 24v-3h3m8 0h3v3m0 8v3h-3m-8 0H9v-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="28" r="2"/></svg>
          <h2>{{t(plan.name)}}</h2>
          <div :class="s.price"><span>US$</span><strong>{{plan.paidMinor/100}}</strong></div>
          <p :class="s.credits"><strong>{{plan.credits.toLocaleString()}}</strong> {{t('创作积分')}}<small v-if="plan.discountPercent"> · {{t('优惠')}} {{plan.discountPercent}}%</small></p>
          <button :class="s.choose" type="button" @click="choose(plan.id as CreationPlanId)">{{t('立即充值')}}</button>
          <p :class="s.billing">{{t('长期有效，不自动续费')}}</p>
        </div>
        <ul :class="s.features">
          <li>{{t('可用生成时长')}} <strong>{{plan.credits/BILLING.creditsPerSecond}} {{t('秒')}}</strong></li>
          <li>{{t('每积分')}} US${{(plan.unitPriceMicroUsd/1_000_000).toFixed(4)}}</li>
          <li v-for="key in sceneKeys" :key="key" data-included="true"><svg :class="s.featureIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg><span>{{t(CREATION_SCENES[key].label)}}</span></li>
        </ul>
      </article>
    </section>
    <p :class="s.status" role="note">{{t('三种功能统一每秒消耗1积分，不足1秒按1秒计费；实时生成未用积分返还。')}}<br/>{{t('当前仅支持沙盒充值，测试积分不能用于真实生成。')}}</p>
  </main>
  <PricingConfirmation v-if="purchasePlan" :plan="purchasePlan" :checkout="walletCheckout" :username="account?.user?.username??null" @close="confirming=null" @confirm="confirm"/>
</template>
