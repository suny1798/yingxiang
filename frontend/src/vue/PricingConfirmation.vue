<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { CREATION_PLANS, CREATION_SCENES, money, type CreationScene } from '../lib/pricing';
import type { CheckoutSnapshot } from '../lib/sandbox-checkout';
import { preferences, t } from './preferences';
import s from '../components/site/pricing.module.css';
const props=defineProps<{plan:typeof CREATION_PLANS[number];checkout:CheckoutSnapshot;username:string|null}>();
const emit=defineEmits<{close:[];confirm:[]}>();
const dialog=ref<HTMLDialogElement|null>(null);
const intlLocale=computed(()=>preferences.locale.value==='en'?'en-US':'zh-CN');
const includedLabels=computed(()=>props.plan.scenes.map(scene=>t(CREATION_SCENES[scene].label)).join(' / '));
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
    <dl :class="s.orderDetails"><div v-if="username"><dt>{{t('购买账号')}}</dt><dd>{{username}}</dd></div><div><dt>{{t('创作积分')}}</dt><dd>{{plan.credits.toLocaleString(intlLocale)}} {{t('积分')}}</dd></div><div><dt>{{t('包含功能')}}</dt><dd>{{includedLabels}}</dd></div><div><dt>{{t('有效期')}}</dt><dd>{{t('长期有效，不自动续费')}}</dd></div></dl>
    <div :class="s.orderTotal"><span>{{t('应付金额')}}</span><strong>¥{{money(plan.priceFen)}}<small>CNY</small></strong></div>
    <p :class="s.sandboxNote">{{t('当前为 Stripe 沙盒测试，不会真实扣款；测试积分不能用于真实生成。')}}<span v-if="(plan.scenes as readonly CreationScene[]).includes('edit')">{{t('实时编辑按独立测试额度开放，沙盒积分不能用于真实生成。')}}</span></p>
    <p v-if="checkout.error" :class="s.checkoutError" role="alert">{{t(checkout.error)}}</p>
    <div :class="s.dialogActions"><button type="button" :disabled="checkout.busy" @click="close">{{t('取消')}}</button><button type="button" :class="s.confirmPay" :disabled="!checkout.ready||!checkout.enabled||checkout.busy" @click="emit('confirm')">{{t(checkout.busy?'正在前往 Stripe…':!checkout.ready?'正在读取支付状态…':!checkout.enabled?'购买暂未开放':!username?'登录后继续':'确认并前往支付')}}<span aria-hidden="true">↗</span></button></div>
  </dialog>
</template>
