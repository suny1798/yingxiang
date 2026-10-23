import { randomUUID } from 'node:crypto';
import { privateJson } from './http';
import { StudioError } from './studio-gate';

export async function studioResponse(action: () => Promise<unknown>): Promise<Response> {
  try { return privateJson(await action()); }
  catch (error) {
    const safe = error instanceof StudioError ? error : new StudioError('SERVICE_UNAVAILABLE', '服务暂不可用，请刷新状态核查，不要重复提交。', 503);
    return privateJson({ error: { code: safe.code, message: safe.message, retryable: false }, requestId: randomUUID() }, safe.status);
  }
}
