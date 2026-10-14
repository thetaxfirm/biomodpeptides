import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { all, parse, timestamp } from '@/lib/runtime';
import { labelEntries, renderLabelSheet, type LabelOrder } from '@/lib/label-sheet';
export const dynamic = 'force-dynamic';
// Read-only sheet of already-bought labels, one per page. Buys nothing and changes no order.
export async function GET(_req: NextRequest) {
    try { await requireStaff('orders:fulfill'); }
    catch {
        return new NextResponse('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Labels</title>'
            + '<p style="font:15px -apple-system,Arial,sans-serif;padding:28px">Administrator sign-in is required to open shipping labels.</p>',
            { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
    }
    type Row = { id: string; status: string; data: string; created: number };
    const rows = await all<Row>("SELECT id,status,data,created FROM orders WHERE status IN ('paid','shipped') AND json_extract(data,'$.shipment.labelUrl') IS NOT NULL ORDER BY created ASC LIMIT 200");
    const orders: LabelOrder[] = rows.map(row => ({ id: row.id, status: row.status, created: row.created, data: parse<Record<string, any>>(row.data, {}) }));
    return new NextResponse(renderLabelSheet(labelEntries(orders), timestamp()), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
}
