import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { one, parse } from '@/lib/runtime';
import { labelPdf } from '@/lib/label-pdf';
import { labelFileName, contentDisposition } from '@/lib/label-filename';
export const dynamic = 'force-dynamic';

/**
 * Serves a bought label as a PDF page exactly four inches by six, so pressing print is the whole
 * job: no page setup, no scaling, no fitting to paper (owner, Nov 10 2026).
 *
 * Read-only. It never buys, changes or voids anything, and it tells the browser not to keep a copy,
 * because a cached label is how yesterday's parcel gets posted twice.
 */
export async function GET(req: NextRequest) {
    try { await requireStaff('orders:read'); }
    catch { return NextResponse.json({ error: 'Administrator sign-in required.' }, { status: 403 }); }

    const id = req.nextUrl.searchParams.get('id') || '';
    if (!/^[a-f0-9-]{36}$/.test(id))
        return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = await one<{ data: string }>('SELECT data FROM orders WHERE id=?', id);
    const saved = parse<Record<string, any>>(order?.data, {});
    const shipment = saved.shipment;
    const source = String(shipment?.labelUrl || '');
    // Only ever the carrier's own file, and only over TLS: the stored value decides what is
    // fetched, so a malformed record must stop here rather than become a request to anywhere.
    if (!order || !/^https:\/\/[^\s]+$/i.test(source))
        return NextResponse.json({ error: 'This order has no label yet.' }, { status: 404 });

    let png: Uint8Array;
    try {
        const response = await fetch(source, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('label unavailable');
        png = new Uint8Array(await response.arrayBuffer());
    }
    catch {
        return NextResponse.json({ error: 'The carrier label could not be fetched. Open it from the order and print it from there.' }, { status: 502 });
    }

    const pdf = labelPdf(png);
    // A format PDF cannot carry directly is not a dead end: send the operator to the carrier's own
    // file so a parcel still goes out today, and say which order it was.
    if (!pdf) return NextResponse.redirect(source, 302);

    return new NextResponse(pdf as unknown as BodyInit, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(pdf.length),
            // Named after whoever it is going to, so a folder of downloads can be matched to boxes.
            'Content-Disposition': contentDisposition('inline', labelFileName(id, saved.address?.name, 'pdf')),
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
        },
    });
}
