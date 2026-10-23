import { accounts } from '@/lib/server/account-store';
import { promptGate } from '@/lib/server/prompt-gate';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export function POST(request: Request) { return studioResponse(async () => promptGate.issue(request, await accounts.requireUser(request))); }
