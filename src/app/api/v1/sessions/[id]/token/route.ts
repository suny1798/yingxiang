import { serviceDisabled } from '@/lib/server/http';

export const runtime = 'nodejs';
export function POST() { return serviceDisabled(); }
