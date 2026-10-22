import { pocGate } from '@/lib/server/poc-gate';
import { pocResponse } from '@/lib/server/poc-http';
export const runtime = 'nodejs';
export function POST(request: Request) { return pocResponse(() => pocGate.issue(request)); }
