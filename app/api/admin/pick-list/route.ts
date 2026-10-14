import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { all, one, parse, timestamp } from '@/lib/runtime';
import { pickEntries, pickEntry, canPick, renderPickList, type PickOrder } from '@/lib/pick-list';
export const dynamic = 'force-dynamic';
// Read-only printable pick sheets. Buys nothing, sends nothing and changes no order.
const page = (html: string, status = 200) => new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
});
const notice = (message: string, status: number) => page('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Pick list</title>'
    + '<p style="font:15px -apple-system,Arial,sans-serif;padding:28px">' + message.replace(/[<>&]/g, '') + '</p>', status);
type Row = { id: string; status: string; data: string; created: number };
const toPickOrder = (row: Row): PickOrder => ({ id: row.id, status: row.status, created: row.created, data: parse<Record<string, any>>(row.data, {}) });

export async function GET(req: NextRequest) {
    try { await requireStaff('orders:read'); }
    catch { return notice('Administrator sign-in is required to open a pick list.', 403); }
    const raw = req.nextUrl.searchParams.get('id') || '';
    const id = /^[a-f0-9-]{36}$/.test(raw) ? raw : '';
    if (raw && !id) return notice('That order number is not valid.', 400);
    if (id) {
        const row = await one<Row>('SELECT id,status,data,created FROM orders WHERE id=?', id);
        if (!row) return notice('Order not found.', 404);
        const order = toPickOrder(row);
        if (!canPick(order)) return notice('This order is not waiting to be picked. Open it in administration to see its current status.', 409);
        return page(renderPickList([pickEntry(order)], timestamp(), true));
    }
    // The To ship queue: paid, nothing picked or labelled yet. Capped so one sheet cannot run away.
    const rows = await all<Row>("SELECT id,status,data,created FROM orders WHERE status IN ('paid','labeling','shipped') ORDER BY created ASC LIMIT 300");
    return page(renderPickList(pickEntries(rows.map(toPickOrder)), timestamp()));
}
