import { requireAdmin } from '@/lib/auth';
import { runtime, database } from '@/lib/runtime';
import { trafficReport } from '@/lib/traffic-metrics-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return trafficReport(req, { requireAdmin, env: runtime, database });
}
