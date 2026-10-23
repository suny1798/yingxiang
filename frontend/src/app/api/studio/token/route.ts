import { accounts } from '@/lib/server/account-store';
import { studioGate } from '@/lib/server/studio-gate';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return studioResponse(async () => {
    const userId = await accounts.requireUser(request);
    return studioGate.issue(request, { userId, claim: (id, durationSec) => accounts.claim(request, userId, id, durationSec), issued: (id) => accounts.issued(userId, id) });
  });
}
