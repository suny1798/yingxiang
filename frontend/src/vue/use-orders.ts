import { onMounted,onUnmounted,shallowRef } from 'vue';
import { envelopeData, envelopeMessage } from '../lib/api-response';
import { notify } from '../lib/notices';
import { SandboxOrders,type OrdersPlatform } from './orders';
import { sessionScope } from './runtime';

async function request<T>(url: string, body: object | undefined, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch { throw new Error(body ? '支付准备未完成，请到订单中核查。' : '支付服务暂不可用。'); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('支付服务暂不可用。'); }
  if (!response.ok) throw new Error(envelopeMessage(value) ?? '支付服务暂不可用。');
  return envelopeData<T>(value);
}

const browserPlatform: OrdersPlatform = {
  request,
  paymentReturn() {
    const query = new URLSearchParams(window.location.search);
    return query.get('payment') === 'returned' ? query.get('orderId') : null;
  },
  navigate: (url: string) => window.location.assign(url),
  notify: (message: string, kind: 'success' | 'error') => notify(message, kind),
};

/** 页面只接线订阅；订单读取、查单与账号世代由SandboxOrders处理。 */
export function useOrders() {
  const orders = new SandboxOrders(sessionScope, browserPlatform);
  const state = shallowRef(orders.getSnapshot());
  const stop = orders.subscribe(() => { state.value = orders.getSnapshot(); });
  onMounted(() => { void orders.load(); });
  onUnmounted(() => { stop(); orders.dispose(); });
  return { state, refresh: () => orders.refresh(), reconcile: (id: string, resume = false) => orders.reconcile(id, resume) };
}
