import { PUBLIC_CONFIG } from '@/lib/contracts';
import { privateJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export function GET() { return privateJson({ ...PUBLIC_CONFIG, features: { ...PUBLIC_CONFIG.features, realtime: process.env.YINGXIANG_STUDIO_ENABLED === 'true' && !!process.env.DECART_API_KEY?.trim() } }); }
