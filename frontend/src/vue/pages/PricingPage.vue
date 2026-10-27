<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { CREATION_PLANS,CREATION_SCENES,creditsFor,estimatedUses,money,type CreationPlanId,type CreationScene } from '../../lib/pricing';
import { pricingFaqs } from '../../lib/public-pricing';
import { preferences,t } from '../preferences';
import { useAccountView } from '../use-account';
import { useSandboxCheckout } from '../use-sandbox-checkout';
import PricingConfirmation from '../PricingConfirmation.vue';
import s from '../../components/site/pricing.module.css';
const selected=ref<CreationPlanId>('creator'),scene=ref<CreationScene>('tryon'),seconds=ref(15),confirming=ref<CreationPlanId|null>(null);
const sceneKeys=Object.keys(CREATION_SCENES) as CreationScene[];
const {snapshot}=useAccountView(); const {state:checkout,buy,clearError}=useSandboxCheckout();
const account=computed(()=>snapshot.value.account);
watch(()=>account.value?.user?.id,()=>{confirming.value=null;});
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const selectedPlan=computed(()=>CREATION_PLANS.find(plan=>plan.id===selected.value)!);
const purchasePlan=computed(()=>CREATION_PLANS.find(plan=>plan.id===confirming.value));
const scenePolicy=computed(()=>CREATION_SCENES[scene.value]);
const cost=computed(()=>creditsFor(scene.value,seconds.value));
const uses=computed(()=>estimatedUses(selected.value,scene.value,seconds.value));
function changeScene(value:CreationScene) {scene.value=value;seconds.value=15;}
function choose(id:CreationPlanId) {selected.value=id;clearError();confirming.value=id;}
function confirm() {const id=confirming.value;if(!id)return;if(!account.value?.user)confirming.value=null;void buy(`credits-v1-${id}`);}
</script>
<template>
  <main :class="s.page">
    <section :class="s.intro"><p :class="s.eyebrow">{{t('套餐与积分')}}</p><h1>{{t('选择适合你的创作套餐')}}</h1><p :class="s.subtitle">{{t('三种创作模式共用套餐积分，积分长期有效，不自动续费。')}}</p></section>
    <section :class="s.plans" :aria-label="t('三档创作套餐')"><article v-for="(plan,index) in CREATION_PLANS" :key="plan.id" :class="s.card" :data-featured="plan.featured" :data-selected="selected===plan.id" @click="selected=plan.id">
      <div :class="s.cardTop"><div :class="s.cardHeading"><svg :class="s.planMark" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path v-if="index>1" d="M15 9V6a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><path v-if="index>0" d="M9 15v-3a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3"/><rect x="4" y="16" width="24" height="24" rx="3"/><path d="M9 24v-3h3m8 0h3v3m0 8v3h-3m-8 0H9v-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="28" r="2"/></svg><span :class="s.planNote">{{t(plan.note)}}</span></div>
        <h2><button type="button" :class="s.planPick" :aria-pressed="selected===plan.id" @click="selected=plan.id">{{t(plan.name)}}<span :class="s.selectionMark" aria-hidden="true">✓</span></button></h2><p :class="s.description">{{t(plan.description)}}</p><div :class="s.price"><span>¥</span><strong>{{plan.priceFen/100}}</strong><span>{{t('/ 包')}}</span></div><p :class="s.billing">{{t('一次性购买 · 积分长期有效')}}</p><button :class="s.choose" type="button" @click.stop="choose(plan.id)">{{t(`选择${plan.name}`)}}</button><p :class="s.renewal">{{t('不自动续费')}}</p>
      </div>
      <div :class="s.cardBenefits"><div :class="s.allowance"><p><strong>{{plan.credits.toLocaleString(intlLocale)}}</strong><span>{{t('创作积分')}}</span></p><small>{{t('约 ¥')}}{{money(plan.priceFen/plan.credits)}}{{t(' / 积分')}}</small></div>
        <ul :class="s.features"><li v-for="key in sceneKeys" :key="key" :data-included="(plan.scenes as readonly CreationScene[]).includes(key)"><svg :class="s.featureIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="(plan.scenes as readonly CreationScene[]).includes(key)?'m4 10 4 4 8-8':'M5 10h10'"/></svg><span>{{t(CREATION_SCENES[key].label)}}</span><small>{{t((plan.scenes as readonly CreationScene[]).includes(key)?'包含':'不包含')}}</small></li></ul>
        <ul :class="s.savedFeatures"><li v-for="label in ['生成视频自动保存到我的作品','作品回放、镜像与下载']" :key="label"><svg :class="s.featureIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg><span>{{t(label)}}</span></li></ul>
      </div>
    </article></section>
    <div :class="s.status" role="note"><span :class="s.statusTag">{{t('沙盒测试')}}</span><p>{{t('可测试付款与积分到账，不会真实扣款；实时编辑按独立测试额度开放，沙盒积分不解锁真实生成。')}}</p></div>
    <section :class="s.usage" aria-labelledby="usage-title"><div :class="s.sectionHeading"><div><p :class="s.eyebrow">{{t('用量估算')}}</p><h2 id="usage-title">{{t('当前套餐可创作次数')}}</h2></div><p>{{t('三种模式共用积分，可按不同功能组合使用。')}}</p></div>
      <div :class="s.calculator"><div :class="s.sceneSwitch" role="group" :aria-label="t('用量估算功能')"><button v-for="key in sceneKeys" :key="key" type="button" :aria-pressed="scene===key" @click="changeScene(key)">{{t(CREATION_SCENES[key].label)}}</button></div><div :class="s.duration" role="group" :aria-label="t('每次示例时长')"><span>{{t('每次')}}</span><button v-for="value in scenePolicy.examples" :key="value" type="button" :aria-pressed="seconds===value" @click="seconds=value">{{value}} {{t(' 秒')}}</button></div><p :class="s.rate">{{cost}} {{t(' 积分 / 次')}}</p></div>
      <div :class="s.estimates" aria-live="polite" aria-atomic="true"><div :class="s.selectedAllowance"><span>{{t('当前所选套餐')}}</span><strong>{{t(selectedPlan.name)}}</strong><span>{{selectedPlan.credits.toLocaleString(intlLocale)}} {{t('创作积分')}}</span></div><div :class="s.estimateResult"><template v-if="uses===null"><strong :class="s.unavailable">{{t('不包含实时编辑')}}</strong><span>{{t('可选创作包或进阶包')}}</span></template><template v-else><span>{{t('预计可创作')}}</span><p><strong>{{uses.toLocaleString(intlLocale)}}</strong><span>{{t('次 × ')}}{{seconds}}{{t(' 秒 · ')}}{{t(scenePolicy.label)}}</span></p><span>{{t(`剩余 ${selectedPlan.credits-uses*cost} 积分`)}}</span></template></div></div>
      <p :class="s.usageNote">{{t('按所选套餐的全部积分估算，切换套餐、功能或时长即可更新；不会扣除积分或启动生成。')}}</p>
    </section>
    <section :class="s.faq" aria-labelledby="faq-title"><div><p :class="s.eyebrow">{{t('购买与使用')}}</p><h2 id="faq-title">{{t('常见问题')}}</h2><RouterLink to="/privacy" target="_blank" rel="noopener noreferrer">{{t('隐私与使用说明 ↗')}}</RouterLink></div><div><details v-for="[question,answer] in pricingFaqs" :key="question"><summary>{{t(question)}}<span aria-hidden="true">＋</span></summary><p>{{t(answer)}}</p></details></div></section>
  </main>
  <PricingConfirmation v-if="purchasePlan" :plan="purchasePlan" :checkout="checkout" :username="account?.user?.username??null" @close="confirming=null" @confirm="confirm"/>
</template>
