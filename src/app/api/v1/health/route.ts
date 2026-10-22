import { privateJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export function GET() { return privateJson({ status: 'ok', application: 'yingxiang', mode: 'mock', providerReady: false, storageReady: false }); }
