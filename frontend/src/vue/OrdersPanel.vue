<script setup lang="ts">
import { computed } from 'vue';
import { CREATION_PLANS,CREATION_SCENES,money } from '../lib/pricing';
import { PAYMENT_STATES } from '../lib/payments';
import { t } from './preferences';
import { useOrders } from './use-orders';
import s from '../components/site/site.module.css';
const {state,refresh,reconcile}=useOrders();
const creditEntries=computed(()=>Object.entries(state.value.credits).filter(([,count])=>count>0));
const pointTotal=computed(()=>state.value.packs.reduce((sum,pack)=>sum+pack.credits,0));
const planName=(id:string)=>CREATION_PLANS.find(plan=>plan.id===id)?.name??id;
const planLabel=(planId?:string|null,credits?:number|null)=>`${t(planName(planId??''))} · ${credits??0}${t('积分 ·')}`;
const packLabel=(packId:string,credits:number)=>`${t(planName(packId))} · ${credits} ${t('积分 ·')} `;
const sceneLabel=(scene:keyof typeof CREATION_SCENES)=>t(CREATION_SCENES[scene].label);
</script>
<template>
  <p>{{t('正式购买暂未开放。以下仅为沙盒订单；返回此页不会自动认定付款。')}}</p>
  <button type="button" :class="s.outline" :disabled="state.busy" @click="refresh()">{{t('刷新订单')}}</button>
  <p v-if="creditEntries.length">{{t('测试权益（不可用于真实模型）：')}}{{creditEntries.map(([seconds,count])=>t(`${seconds}秒 × ${count}次`)).join(' / ')}}</p>
  <div v-if="state.packs.length">
    <p>{{t('测试积分：')}}{{pointTotal}} {{t(' · 长期有效 · 不可用于真实模型')}}</p>
    <p v-for="pack in state.packs" :key="pack.orderId">{{packLabel(pack.planId,pack.credits)}}{{pack.scenes.map(sceneLabel).join(' / ')}}</p>
  </div>
  <p v-if="state.error" role="alert">{{t(state.error)}}</p>
  <div v-if="state.orders.length" :class="s.historyTable">
    <table>
      <thead><tr><th>{{t('沙盒方案')}}</th><th>{{t('金额')}}</th><th>{{t('状态')}}</th><th>{{t('核查')}}</th></tr></thead>
      <tbody>
        <tr v-for="order in state.orders" :key="order.id">
          <td>{{t(order.planId?planLabel(order.planId,order.credits):`${order.seconds}秒 × ${order.count}次`)}}<br/><small>{{order.id}}</small></td>
          <td>¥{{t(money(order.amount))}}</td>
          <td>{{t(PAYMENT_STATES[order.state])}}</td>
          <td>
            <button type="button" :disabled="state.busy" @click="reconcile(order.id)">{{t('查单')}}</button>
            <button v-if="order.state==='pending'||order.state==='creating'" type="button" :disabled="state.busy" @click="reconcile(order.id,true)">{{t('继续测试付款')}}</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else>{{t('暂无沙盒订单。')}}</p>
</template>
