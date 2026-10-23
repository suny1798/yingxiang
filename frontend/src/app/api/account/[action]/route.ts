import { accounts } from '@/lib/server/account-store';
import { privateJson } from '@/lib/server/http';
import { studioResponse } from '@/lib/server/studio-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  if ((await context.params).action !== 'me') return privateJson({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
  return studioResponse(() => accounts.me(request));
}
export async function POST(request: Request, context: Context) {
  const { action } = await context.params;
  // 响应在异常包装内构建，Cookie不进入JSON或日志。
  let result: Response | undefined;
  const failure = await studioResponse(async () => {
    if (action === 'register' || action === 'login') {
      const value = await accounts.authenticate(request, action === 'register');
      result = privateJson(value.view); result.headers.set('Set-Cookie', value.cookie);
    } else if (action === 'logout') {
      const cookie = await accounts.logout(request);
      result = privateJson({ accepted: true }); result.headers.set('Set-Cookie', cookie);
    } else { result = privateJson({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404); }
    return { accepted: true };
  });
  return result ?? failure;
}
