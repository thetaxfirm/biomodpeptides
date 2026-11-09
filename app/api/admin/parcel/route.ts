import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { one, parse, runtime } from '@/lib/runtime';
import { readShipmentTracker } from '@/lib/easypost';
import { labelSource, parcelEntry, renderParcelSheet, trackingHistory, type ParcelHistory } from '@/lib/parcel-sheet';
export const dynamic = 'force-dynamic';
// Track page: the carrier's scans beside the shipping label, to copy into an email when a parcel
// has a problem. Read-only: it buys, sends and changes nothing. ?label=png serves the saved label
// file from this site so the browser can copy or download it.
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const page = (html: string, status = 200) => new NextResponse(html, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
const notice = (message: string, status: number) => page('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Track</title>'
    + '<p style="font:15px -apple-system,Arial,sans-serif;padding:28px">' + message.replace(/[<>&]/g, '') + '</p>', status);

export async function GET(req: NextRequest) {
    try { await requireStaff('orders:read'); }
    catch { return notice('Administrator sign-in is required to open tracking and labels.', 403); }
    const raw = req.nextUrl.searchParams.get('id') || '';
    const id = /^[a-f0-9-]{36}$/.test(raw) ? raw : '';
    const row = id ? await one<{ id: string; data: string }>('SELECT id,data FROM orders WHERE id=?', id) : null;
    if (!row) return notice('Order not found.', 404);
    const data = parse<Record<string, any>>(row.data, {}), shipment = data.shipment || {};
    const entry = parcelEntry({ id: row.id, data });

    if (req.nextUrl.searchParams.get('label') === 'png') {
        // Only the label saved on this order, and only from EasyPost's file host: never a URL from the request.
        const source = labelSource(shipment.labelUrl);
        if (!source) return new NextResponse('No label file is saved for this order.', { status: 404, headers });
        let file: Response;
        try { file = await fetch(source); } catch { return new NextResponse('The label file could not be read.', { status: 502, headers }); }
        const type = (file.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!file.ok || !['image/png', 'image/jpeg', 'image/gif'].includes(type)) return new NextResponse('The label file could not be read.', { status: 502, headers });
        const disposition = (req.nextUrl.searchParams.get('download') ? 'attachment' : 'inline') + '; filename="' + entry.labelFile + '"';
        return new NextResponse(file.body, { headers: { ...headers, 'Content-Type': type, 'Content-Disposition': disposition } });
    }

    if (!shipment.tracking && !shipment.labelUrl) return page(renderParcelSheet(entry, null, 'No label has been bought for this order, so there is nothing to track.'));
    let history: ParcelHistory | null = null;
    try { history = trackingHistory(await readShipmentTracker(runtime(), String(shipment.shipmentId || ''), String(shipment.tracking || ''))); }
    catch { history = null; }
    return page(renderParcelSheet(entry, history, 'The carrier history could not be read just now. Open the carrier page for the latest scans.'));
}
