import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { catalog } from '@/lib/commerce';
import { database } from '@/lib/runtime';
import { customerPricePreview } from '@/lib/customer-price-preview';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function access() { try { await requireStaff('catalog:write'); } catch { await requireStaff('store:write'); } }
export async function GET() {
    try { await access(); } catch { return json({ error: 'Product or settings access required.' }, 403); }
    try { return json({ products: (await catalog(false)).map(p => ({ id: p.id, name: p.name, sizes: p.sizes })) }); }
    catch { return json({ error: 'Products could not load. Please retry.' }, 503); }
}
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin) return json({ error: 'Refresh administration and try again.' }, 403);
    try { await access(); } catch { return json({ error: 'Product or settings access required.' }, 403); }
    try { const body = await req.json() as { lines?: unknown; code?: unknown }; return json(await customerPricePreview(database(), body.lines, body.code)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'The price could not be calculated.' }, 400); }
}
