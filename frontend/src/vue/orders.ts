import type { PaymentOrderView, PaymentsView, SandboxCreditPackView } from '../lib/api-schema';
import { PAYMENT_STATES, checkoutDestination } from '../lib/payments';
import type { SessionScope } from './session-scope';

export type OrdersSnapshot = Readonly<{
  owner: string | null;
  orders: PaymentOrderView[];
  credits: Record<string, number>;
  packs: SandboxCreditPackView[];
  loading: boolean;
  busy: boolean;
  error: string;
}>;

export interface OrdersPlatform {
  request<T>(url: string, body: object | undefined, signal: AbortSignal): Promise<T>;
  /** 仅在 `?payment=returned&orderId=` 时返回订单编号；返回页不自动认定付款。 */
  paymentReturn(): string | null;
  navigate(url: string): void;
  notify(message: string, kind: 'success' | 'error'): void;
}

const readError = '订单读取失败。';

function paymentsView(value: unknown): PaymentsView {
  const view = value as PaymentsView;
  const validOrder = (order: PaymentOrderView) => Boolean(order) && typeof order.id === 'string' && order.id.length > 0
    && Object.hasOwn(PAYMENT_STATES, order.state) && Number.isFinite(order.amount);
  if (!view || typeof view !== 'object' || Array.isArray(view) || !Array.isArray(view.orders) || !view.orders.every(validOrder)
    || !view.sandboxCredits || typeof view.sandboxCredits !== 'object' || Array.isArray(view.sandboxCredits)
    || !Object.values(view.sandboxCredits).every((item) => Number.isSafeInteger(item) && item >= 0)
    || (view.sandboxCreditPacks !== undefined && (!Array.isArray(view.sandboxCreditPacks) || !view.sandboxCreditPacks.every((pack) => Boolean(pack) && typeof pack.orderId === 'string' && Number.isSafeInteger(pack.credits)))))
    throw new Error(readError);
  return view;
}

/** 订单页只读本人沙盒订单；查单和继续付款都须用户显式点击，不自动重试或认定付款。 */
export class SandboxOrders {
  private current: OrdersSnapshot = { owner: null, orders: [], credits: {}, packs: [], loading: false, busy: false, error: '' };
  private listeners = new Set<() => void>();
  private inflight: AbortController | null = null;
  private disposed = false;
  private returnOrder: string | null | undefined;
  private readonly stopIdentity: () => void;

  constructor(private readonly scope: SessionScope, private readonly platform: OrdersPlatform) {
    this.stopIdentity = scope.onIdentityChange(() => {
      this.abort();
      this.publish({ owner: null, orders: [], credits: {}, packs: [], loading: false, busy: false, error: '' });
      void this.load();
    });
  }

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<OrdersSnapshot>) {
    if (this.disposed) return;
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private abort() { this.inflight?.abort(); this.inflight = null; }
  private apply(value: PaymentsView) {
    this.publish({ orders: value.orders, credits: value.sandboxCredits as Record<string, number>, packs: value.sandboxCreditPacks ?? [] });
  }

  /** 首次读取：返回页按订单编号查单，其余只读列表；不自动继续付款。 */
  async load() {
    if (this.disposed) return;
    const token = this.scope.capture();
    this.abort();
    if (!token.userId) { this.publish({ owner: null, orders: [], credits: {}, packs: [], loading: false, busy: false, error: '' }); return; }
    // 返回页的订单编号只在首次进入时读取一次；手动刷新不重复查单，也不自动继续付款。
    if (this.returnOrder === undefined) this.returnOrder = this.platform.paymentReturn();
    const orderId = this.returnOrder;
    this.returnOrder = null;
    const controller = new AbortController();
    this.inflight = controller;
    this.publish({ owner: token.userId, loading: true, error: '' });
    try {
      const value = paymentsView(orderId
        ? await this.platform.request<unknown>('/api/payments/reconcile', { orderId }, controller.signal)
        : await this.platform.request<unknown>('/api/payments/orders', undefined, controller.signal));
      if (controller.signal.aborted) return;
      this.scope.assertCurrent(token);
      this.apply(value);
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.publish({ error: cause instanceof Error ? cause.message : readError });
      this.platform.notify(cause instanceof Error ? cause.message : readError, 'error');
    } finally {
      if (this.inflight === controller) this.inflight = null;
      this.publish({ loading: false });
    }
  }

  refresh() { return this.load(); }

  /** 显式查单；resume 只在“继续测试付款”时跳转官方收银台。 */
  async reconcile(orderId: string, resume = false) {
    if (this.disposed || this.current.busy) return;
    const token = this.scope.capture();
    if (!token.userId) return;
    const controller = new AbortController();
    this.inflight?.abort();
    this.inflight = controller;
    this.publish({ busy: true, error: '' });
    try {
      const value = paymentsView(await this.platform.request<unknown>('/api/payments/reconcile', { orderId }, controller.signal));
      if (controller.signal.aborted) return;
      this.scope.assertCurrent(token);
      this.apply(value);
      if (resume && typeof value.url === 'string' && value.url) this.platform.navigate(checkoutDestination(value.url));
    } catch (cause) {
      if (controller.signal.aborted || !this.scope.current(token)) return;
      this.publish({ error: cause instanceof Error ? cause.message : readError });
      this.platform.notify(cause instanceof Error ? cause.message : readError, 'error');
    } finally {
      if (this.inflight === controller) this.inflight = null;
      this.publish({ busy: false });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    this.stopIdentity();
    this.listeners.clear();
  }
}
