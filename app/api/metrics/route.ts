import { runtime, database } from '@/lib/runtime';
import { handleTrafficPost } from '@/lib/traffic-metrics-server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return handleTrafficPost(req, { env: runtime, database });
}
