import { accounts } from '@/lib/server/account-store';
import { videoJobs } from '@/lib/server/video-jobs';
import { studioResponse } from '@/lib/server/studio-http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await videoJobs.content(request, await accounts.requireUser(request, false), (await context.params).id); }
  catch (error) { return studioResponse(async () => { throw error; }); }
}
