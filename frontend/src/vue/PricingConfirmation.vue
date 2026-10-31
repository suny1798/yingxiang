<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { money } from '../lib/pricing';
import { BILLING,type TopupPlan } from '../lib/billing';
import type { CheckoutSnapshot } from '../lib/sandbox-checkout';
import { t } from './preferences';
import s from '../components/site/pricing.module.css';
const props=defineProps<{plan:TopupPlan;checkout:CheckoutSnapshot;username:string|null}>();
const emit=defineEmits<{close:[];confirm:[]}>();
const dialog=ref<HTMLDialogElement|null>(null);
const includedLabels=computed(()=>['实时换装','视频换装','实时编辑'].map(t).join(' / '));
onMounted(()=>dialog.value?.showModal()); onUnmounted(()=>dialog.value?.close());
function close() { if(!props.checkout.busy) emit('close'); }
function backdrop(event:MouseEvent) {
  if(event.target!==event.currentTarget)return;
  const rect=dialog.value!.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
}
</script>
<template>
  <dialog ref="dialog" :class="s.confirmDialog" aria-labelledby="purchase-title" aria-describedby="purchase-description" @cancel.prevent="close" @click="backdrop">
    <div :class="s.dialogTop"><span>{{t('确认订单')}}</span><button type="button" autofocus :disabled="checkout.busy" :aria-label="t('关闭订单确认')" @click="close">×</button></div>
    <h2 id="purchase-title">{{t(plan.name)}}<span>{{t('一次性购买')}}</span></h2><p id="purchase-description" :class="s.dialogIntro">{{t('确认套餐信息后，前往 Stripe 沙盒支付。')}}</p>
    <dl :class="s.orderDetails"><div v-if="username"><dt>{{t('购买账号')}}</dt><dd>{{username}}</dd></div><div><dt>{{t('到账积分')}}</dt><dd>{{plan.credits}} {{t('积分')}}</dd></div><div><dt>{{t('单积分价格')}}</dt><dd>US${{(plan.unitPriceMicroUsd/1_000_000).toFixed(4)}}</dd></div><div><dt>{{t('可用时长')}}</dt><dd>{{plan.credits/BILLING.creditsPerSecond}} {{t('秒')}}</dd></div><div><dt>{{t('包含功能')}}</dt><dd>{{includedLabels}}</dd></div><div><dt>{{t('计费单价')}}</dt><dd>1 {{t('积分')}} / {{t('秒')}}</dd></div></dl>
    <div :class="s.orderTotal"><span>{{t('应付金额')}}</span><strong>US${{money(plan.paidMinor)}}<small>USD</small></strong></div>
    <p :class="s.sandboxNote">{{t('当前仅支持沙盒充值，测试积分不能用于真实生成。')}}</p>
    <p v-if="checkout.error" :class="s.checkoutError" role="alert">{{t(checkout.error)}}</p>
    <div :class="s.dialogActions"><button type="button" :disabled="checkout.busy" @click="close">{{t('取消')}}</button><button type="button" :class="s.confirmPay" :disabled="!checkout.ready||!checkout.enabled||checkout.busy" @click="emit('confirm')">{{t(checkout.busy?'正在前往 Stripe…':!checkout.ready?'正在读取支付状态…':!checkout.enabled?'购买暂未开放':!username?'登录后继续':'确认并前往支付')}}<span aria-hidden="true">↗</span></button></div>
  </dialog>
</template>
