import { requireAdmin } from '@/lib/auth';
import { runtime, database } from '@/lib/runtime';
import { shoppingReport } from '@/lib/traffic-metrics-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return shoppingReport(req, { requireAdmin, env: runtime, database });
}
