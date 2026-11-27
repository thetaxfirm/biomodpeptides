import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { financialReport } from '@/lib/admin-finance';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: NextRequest) {
  try { await requireStaff('reports:read'); } catch { return json({ error: 'Reporting access required.' }, 403); }
  const days = req.nextUrl.searchParams.get('days');
  if (days !== null && days !== '7' && days !== '30') return json({ error: 'Choose 7 or 30 complete days.' }, 400);
  try { return json(await financialReport(database(), days)); }
  catch { return json({ error: 'Financial totals could not load. Try again.' }, 503); }
}
