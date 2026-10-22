import { randomUUID } from 'node:crypto';
import { privateJson } from './http';
import { PocError } from './poc-gate';

export async function pocResponse(action: () => Promise<unknown>): Promise<Response> {
  try { return privateJson(await action()); }
  catch (error) {
    const safe = error instanceof PocError ? error : new PocError('POC_UNAVAILABLE', '本地验证暂不可用，本轮未继续签发。', 503);
    return privateJson({ error: { code: safe.code, message: safe.message, retryable: false }, requestId: randomUUID() }, safe.status);
  }
}
