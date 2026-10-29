import { ALLOWED_MIMES, CONSENT_VERSION, IMAGE_LIMITS, MAX_DURATION_SEC, DEFAULT_DURATION_SEC } from './limits';
import { DURATION_OPTIONS } from './studio/policy';

export const PUBLIC_CONFIG = {
  apiVersion: 'v1',
  mode: 'real',
  scene: 'clothing',
  maxDurationSec: MAX_DURATION_SEC,
  defaultDurationSec: DEFAULT_DURATION_SEC,
  durationOptions: DURATION_OPTIONS,
  consentVersion: CONSENT_VERSION,
  image: { ...IMAGE_LIMITS, mimeTypes: ALLOWED_MIMES },
  features: { camera: true, realtime: false, invitations: false, promptEditing: false },
} as const;

/** 后端统一错误包络：code 为通用码，reason 保留细分业务原因。 */
export interface ApiError { code: number; data: null; message: string; requestId?: string | null; reason?: string | null }
