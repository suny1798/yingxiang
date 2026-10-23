import { PRICING, type Duration, type PackCount } from './pricing';

export interface PaymentOrder {
  id: string; userId: string; requestId: string; sku: string; seconds: Duration; count: PackCount;
  amount: number; currency: 'cny'; createdAt: string; state: 'creating' | 'pending' | 'paid' | 'failed' | 'expired';
  sessionId?: string; checkoutUrl?: string; expiresAt?: number; fulfilledAt?: string;
}
export type OrderView = Pick<PaymentOrder, 'id' | 'sku' | 'seconds' | 'count' | 'amount' | 'currency' | 'createdAt' | 'state' | 'fulfilledAt'>;
export const orderView = ({ id, sku, seconds, count, amount, currency, createdAt, state, fulfilledAt }: PaymentOrder): OrderView =>
  ({ id, sku, seconds, count, amount, currency, createdAt, state, fulfilledAt });
/** 版本化商品编号；客户端只提交编号，金额、币种、次数由服务端重新解析。 */
export function paymentProduct(sku: unknown) {
  for (const plan of PRICING) for (const count of [1, 5, 10] as const) {
    if (sku === `tryon-v1-${plan.seconds}-${count}`) return { sku, seconds: plan.seconds, count, amount: plan.prices[count], currency: 'cny' as const };
  }
  throw new Error('INVALID_SKU');
}
export const PAYMENT_STATES = { creating: '正在准备支付', pending: '等待付款确认', paid: '测试付款已确认', failed: '付款未完成', expired: '支付链接已过期' } as const;
