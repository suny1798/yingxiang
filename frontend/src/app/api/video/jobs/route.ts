import { accounts } from '@/lib/server/account-store';
import { videoJobs } from '@/lib/server/video-jobs';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return studioResponse(async () => videoJobs.status(request, (await accounts.me(request)).user?.id ?? null)); }
export function POST(request: Request) { return studioResponse(async () => videoJobs.submit(request, await accounts.requireUser(request))); }
