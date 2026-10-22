/** 前后端共享的产品限制，不含供应商或密钥配置。 */
export const MAX_DURATION_SEC = 60;
export const CONSENT_VERSION = '2026-10-22-v1';
export const IMAGE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000, maxEdge: 1024 } as const;
export const ALLOWED_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
