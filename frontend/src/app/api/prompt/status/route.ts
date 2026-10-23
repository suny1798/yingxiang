import { accounts } from '@/lib/server/account-store';
import { promptGate } from '@/lib/server/prompt-gate';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return studioResponse(async () => promptGate.status(request, (await accounts.me(request)).user?.id ?? null)); }
