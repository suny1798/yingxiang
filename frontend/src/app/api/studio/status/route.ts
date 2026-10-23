import { accounts } from '@/lib/server/account-store';
import { studioGate } from '@/lib/server/studio-gate';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return studioResponse(async () => {
  const status = await studioGate.status(request);
  const account = await accounts.me(request);
  return { ...status, access: account.user && account.trialRemaining > 0 ? status.access : undefined };
}); }
