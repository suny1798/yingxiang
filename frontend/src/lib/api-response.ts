/** 后端统一响应包络：{ code, data, message, requestId?, reason? }。 */
export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
  requestId?: string | null;
  reason?: string | null;
}

/** 兼容过渡期：已包装响应取 data，未包装响应原样返回。 */
export function envelopeData<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'code' in value && 'data' in value) {
    return (value as ApiEnvelope<T>).data;
  }
  return value as T;
}

/** 从包络中读取可展示的错误信息。 */
export function envelopeMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : undefined;
}
