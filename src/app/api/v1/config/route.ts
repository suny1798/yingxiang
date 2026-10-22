import { PUBLIC_CONFIG } from '@/lib/contracts';
import { privateJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export function GET() { return privateJson(PUBLIC_CONFIG); }
