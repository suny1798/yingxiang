<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { CREATION_PLANS,CREATION_SCENES,type CreationPlanId,type CreationScene } from '../../lib/pricing';
import { preferences,t } from '../preferences';
import { useAccountView } from '../use-account';
import { useSandboxCheckout } from '../use-sandbox-checkout';
import PricingConfirmation from '../PricingConfirmation.vue';
import s from '../../components/site/pricing.module.css';
const confirming=ref<CreationPlanId|null>(null);
const sceneKeys=Object.keys(CREATION_SCENES) as CreationScene[];
const {snapshot}=useAccountView();
const {state:checkout,buy,clearError}=useSandboxCheckout();
const account=computed(()=>snapshot.value.account);
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const purchasePlan=computed(()=>CREATION_PLANS.find(plan=>plan.id===confirming.value));
watch(()=>account.value?.user?.id,()=>{confirming.value=null;});
function choose(id:CreationPlanId) {clearError();confirming.value=id;}
function confirm() {const id=confirming.value;if(!id)return;if(!account.value?.user)confirming.value=null;void buy(`credits-v1-${id}`);}
</script>
<template>
  <main data-pricing-page :class="s.page">
    <header :class="s.intro"><h1>{{t('套餐与积分')}}</h1></header>
    <section :class="s.plans" :aria-label="t('三档创作套餐')">
      <article v-for="(plan,index) in CREATION_PLANS" :key="plan.id" :class="s.card" :data-featured="plan.featured">
        <div :class="s.cardTop">
          <svg :class="s.planMark" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path v-if="index>1" d="M15 9V6a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><path v-if="index>0" d="M9 15v-3a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><rect x="4" y="16" width="24" height="24" rx="3"/><path d="M9 24v-3h3m8 0h3v3m0 8v3h-3m-8 0H9v-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="28" r="2"/></svg>
          <h2>{{t(plan.name)}}</h2>
          <div :class="s.price"><span>¥</span><strong>{{plan.priceFen/100}}</strong><span>{{t('/ 包')}}</span></div>
          <p :class="s.credits"><strong>{{plan.credits.toLocaleString(intlLocale)}}</strong> {{t('创作积分')}}</p>
          <button :class="s.choose" type="button" @click="choose(plan.id)">{{t(`选择${plan.name}`)}}</button>
          <p :class="s.billing">{{t('长期有效，不自动续费')}}</p>
        </div>
        <ul :class="s.features">
          <li v-for="key in sceneKeys" :key="key" :data-included="(plan.scenes as readonly CreationScene[]).includes(key)"><svg :class="s.featureIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="(plan.scenes as readonly CreationScene[]).includes(key)?'m4 10 4 4 8-8':'M5 10h10'"/></svg><span><span v-if="!(plan.scenes as readonly CreationScene[]).includes(key)" :class="s.visuallyHidden">{{t('不包含')}} </span>{{t(CREATION_SCENES[key].label)}}</span></li>
          <li v-for="label in ['生成视频自动保存到我的作品','作品回放、镜像与下载']" :key="label"><svg :class="s.featureIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg><span>{{t(label)}}</span></li>
        </ul>
      </article>
    </section>
    <p :class="s.status" role="note">{{t('当前为 Stripe 沙盒测试，不会真实扣款；测试积分不能用于真实生成。')}}</p>
  </main>
  <PricingConfirmation v-if="purchasePlan" :plan="purchasePlan" :checkout="checkout" :username="account?.user?.username??null" @close="confirming=null" @confirm="confirm"/>
</template>
