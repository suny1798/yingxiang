import { accounts } from '@/lib/server/account-store';
import { checkout, reconcile, webhook, paymentEnabled } from '@/lib/server/stripe-payments';
import { studioResponse } from '@/lib/server/studio-http';
import { privateJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  const { action } = await context.params;
  if (action === 'status') return privateJson({ testEnabled: paymentEnabled(), liveEnabled: false });
  if (action === 'orders') return studioResponse(() => accounts.paymentOrders(request));
  return privateJson({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
}
export async function POST(request: Request, context: Context) {
  const { action } = await context.params;
  if (action === 'checkout') return studioResponse(() => checkout(request));
  if (action === 'reconcile') return studioResponse(() => reconcile(request));
  if (action === 'webhook') return studioResponse(() => webhook(request));
  return privateJson({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
}
