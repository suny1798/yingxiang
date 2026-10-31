import catalog from './billing-catalog.json';

export const BILLING = catalog;
export type BillingScene = 'studio' | 'video' | 'prompt';
export const TOPUP_PLANS = catalog.plans.map(plan => ({...plan,sku:`${catalog.version}-${plan.id}`,
  unitPriceMicroUsd:plan.paidMinor*10_000/plan.credits,
  discountPercent:Math.round((1-plan.paidMinor*10_000/plan.credits/catalog.basePriceMicroUsdPerCredit)*100)}));
export type TopupPlan = typeof TOPUP_PLANS[number];
export const moneyMinor = (amount:number) => (amount/100).toFixed(2);
export function usageQuote(scene:BillingScene, seconds:number) {
  if(!['studio','video','prompt'].includes(scene)||!Number.isFinite(seconds)||seconds<=0
    ||(scene==='video'?seconds>catalog.videoMaxSeconds:!catalog.realtimeSeconds.includes(seconds))) throw new Error('无效计费时长');
  const billedSeconds=Math.ceil(seconds);
  return {billedSeconds,credits:billedSeconds*catalog.creditsPerSecond};
}
export function settleQuote(reservedSeconds:number,actualSeconds:number) {
  const reserved=usageQuote('studio',reservedSeconds).credits;
  if(!Number.isFinite(actualSeconds)||actualSeconds<0||actualSeconds>reservedSeconds) throw new Error('无效结算时长');
  const billedSeconds=Math.ceil(actualSeconds),chargedCredits=billedSeconds*catalog.creditsPerSecond;
  return {billedSeconds,chargedCredits,returnedCredits:reserved-chargedCredits};
}
export interface WalletBalance {
  availableCredits:number;reservedCredits:number;spentCredits:number;billingEnabled:boolean;realtimeMeterReady:boolean;
  history:Array<{id:string;scene:BillingScene;state:'reserved'|'review'|'settled'|'released';reserved_ms:number;reserved_credits:number;settled_ms:number|null;charged_credits:number|null;created_at:number}>;
}
export interface WalletView {real:WalletBalance;sandbox:WalletBalance}
