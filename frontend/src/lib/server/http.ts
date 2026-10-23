import { randomUUID } from 'node:crypto';
import type { ApiError } from '../contracts';

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/** 当前无真实提供商。即使设置了环境变量，也不会签令牌或发起上游请求。 */
export function serviceDisabled(): Response {
  const body: ApiError = { error: { code: 'SERVICE_DISABLED', message: '账号与会话服务尚未启用。', retryable: false }, requestId: randomUUID() };
  return privateJson(body, 503);
}
