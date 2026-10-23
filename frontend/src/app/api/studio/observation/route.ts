import { accounts } from '@/lib/server/account-store';
import { studioGate, readBoundedJson } from '@/lib/server/studio-gate';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export function POST(request: Request) { return studioResponse(async () => {
  const userId = await accounts.requireUser(request);
  const body = await readBoundedJson(request.clone().body);
  await studioGate.observe(request, userId);
  await accounts.observe(userId, body.attemptId as string, body.outcome as 'ended' | 'error');
  return { accepted: true };
}); }
