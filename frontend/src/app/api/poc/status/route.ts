import { pocGate } from '@/lib/server/poc-gate';
import { pocResponse } from '@/lib/server/poc-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return pocResponse(() => pocGate.status(request)); }
