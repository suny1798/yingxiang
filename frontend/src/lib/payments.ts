import { CREATION_PLANS, type CreationPlanId } from './pricing';
import { TOPUP_PLANS } from './billing';
import { PRICING, type Duration, type PackCount } from './legacy-pricing';

export interface PaymentOrder {
  id: string; userId: string; requestId: string; sku: string; seconds: Duration | null; count: PackCount | null; planId?: CreationPlanId; credits?: number;
  amount: number; currency: 'cny' | 'usd'; createdAt: string; state: 'creating' | 'pending' | 'paid' | 'failed' | 'expired';
  sessionId?: string; checkoutUrl?: string; expiresAt?: number; fulfilledAt?: string;
}
export type OrderView = Pick<PaymentOrder, 'id' | 'sku' | 'seconds' | 'count' | 'amount' | 'currency' | 'createdAt' | 'state' | 'fulfilledAt' | 'planId' | 'credits'>;
export const orderView = ({ id, sku, seconds, count, amount, currency, createdAt, state, fulfilledAt, planId, credits }: PaymentOrder): OrderView =>
  ({ id, sku, seconds, count, amount, currency, createdAt, state, fulfilledAt, ...(planId ? { planId, credits } : {}) });
/** 版本化商品编号；客户端只提交编号，金额、币种、次数由服务端重新解析。 */
export function paymentProduct(sku: unknown) {
  for (const plan of TOPUP_PLANS) if (sku===plan.sku) return {sku,planId:plan.id,credits:plan.credits,amount:plan.paidMinor,currency:'usd' as const};
  for (const plan of CREATION_PLANS) if (sku === `credits-v1-${plan.id}`) return { sku, planId: plan.id, credits: plan.credits, amount: plan.priceFen, currency: 'cny' as const };
  for (const plan of PRICING) for (const count of [1, 5, 10] as const) {
    if (sku === `tryon-v1-${plan.seconds}-${count}`) return { sku, seconds: plan.seconds, count, amount: plan.prices[count], currency: 'cny' as const };
  }
  throw new Error('INVALID_SKU');
}
export const PAYMENT_STATES = { creating: '正在准备支付', pending: '等待付款确认', paid: '测试付款已确认', failed: '付款未完成', expired: '支付链接已过期' } as const;

/** 支付跳转只允许Stripe官方收银台；无链接时返回本站核查订单。 */
export function checkoutDestination(value: unknown): string {
  if (value === undefined || value === null || value === '') return '/account/orders';
  if (typeof value !== 'string') throw new Error('支付链接无法验证。');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('支付链接无法验证。'); }
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) throw new Error('支付链接无法验证。');
  return url.href;
}
