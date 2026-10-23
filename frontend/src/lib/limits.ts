import { DURATION_OPTIONS, STUDIO_POLICY } from './studio/policy';
/** 前后端共享的产品限制，不含密钥。 */
export const DEFAULT_DURATION_SEC = STUDIO_POLICY.clientWindowSec;
export const MAX_DURATION_SEC = Math.max(...DURATION_OPTIONS);
export const CONSENT_VERSION = STUDIO_POLICY.consentVersion;
export const IMAGE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000, maxEdge: 1024 } as const;
export const MAX_GARMENTS = 6;
export const ALLOWED_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
