import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { financialReport } from '@/lib/admin-finance';
import { ReportWindowError } from '@/lib/report-window';
import { diagnosticWindow } from '@/lib/sales-diagnostics';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: NextRequest) {
  try { await requireStaff('reports:read'); } catch { return json({ error: 'Reporting access required.' }, 403); }
  const days = req.nextUrl.searchParams.get('days');
  try { const now=Date.now();diagnosticWindow(days,now,req.nextUrl.searchParams);return json(await financialReport(database(), days, now, req.nextUrl.searchParams)); }
  catch (error) { return error instanceof ReportWindowError ? json({error:error.message},400) : json({ error: 'Financial totals could not load. Try again.' }, 503); }
}
