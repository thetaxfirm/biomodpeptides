import { printableOrders } from '@/lib/order-queue-db';
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database, timestamp } from '@/lib/runtime';
import { labelEntries, type LabelOrder } from '@/lib/label-sheet';
import { labelPdf } from '@/lib/label-pdf';
import { labelFileName, contentDisposition } from '@/lib/label-filename';
import { zipArchive, archiveName, type ArchiveEntry } from '@/lib/label-archive';
export const dynamic = 'force-dynamic';

/** At most this many in one press. Waiting labels are normally a handful, and a hundred carrier
 *  fetches in a single request is how this stops finishing at all. */
const MAX_LABELS = 60;
/** Enough carrier fetches at once to be quick, few enough not to be rude to them. */
const AT_ONCE = 6;

/**
 * Every waiting label as its own borderless four-by-six PDF, zipped into one dated folder
 * (owner, Nov 16 2026: "all singles in a folder with the date").
 *
 * Read-only throughout: it serves labels the carrier already issued, and buys, changes and voids
 * nothing. A label that cannot be fetched or converted is left out rather than failing the whole
 * download, and the response says how many were skipped so nobody assumes a full box.
 */
export async function GET(req: NextRequest) {
    try { await requireStaff('orders:fulfill'); }
    catch { return NextResponse.json({ error: 'Administrator sign-in required.' }, { status: 403 }); }

    const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
    const { orders, total } = await printableOrders(database(), 'labels', offset, MAX_LABELS);
    const waiting = labelEntries(orders);
    if (!waiting.length) return NextResponse.json({ error: total ? 'No labels remain in this batch. Start again from Orders.' : 'No bought labels are waiting.' }, { status: 404 });
    const omitted: string[] = [];
    const names = new Map(orders.map(order => [order.id, (order.data as Record<string, any>)?.address?.name]));
    const files: ArchiveEntry[] = [];
    let skipped = 0;
    for (let i = 0; i < waiting.length; i += AT_ONCE) {
        const batch = await Promise.all(waiting.slice(i, i + AT_ONCE).map(async entry => {
            // Only ever the carrier's own file, and only over TLS: the stored value decides what is
            // fetched, so a malformed record must stop here rather than become a request anywhere.
            if (!/^https:\/\/[^\s]+$/i.test(entry.labelUrl)) return null;
            try {
                const response = await fetch(entry.labelUrl, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(15000) });
                if (!response.ok) return null;
                const pdf = labelPdf(new Uint8Array(await response.arrayBuffer()));
                return pdf ? { name: labelFileName(entry.id, names.get(entry.id), 'pdf'), bytes: pdf } : null;
            }
            catch { return null; }
        }));
        for (let n = 0; n < batch.length; n++) { const file = batch[n]; if (file) files.push(file); else { skipped++; omitted.push(waiting[i + n].number + ': carrier file could not be downloaded or converted'); } }
    }


    const now = timestamp();
    const prepared = files.length, nextOffset = offset + waiting.length;
    const manifest = [
        'BIOMOD waiting labels',
        `${prepared} labels prepared from this batch of ${waiting.length}. ${total} eligible labels at the time of this download.`,
        `Batch ${offset + 1}-${nextOffset} of ${total}. Printing changes no order.`,
        ...(nextOffset < total ? [`More labels remain: https://trybiomod.com/api/admin/labels?offset=${nextOffset}`, 'Download remaining batches before marking parcels dropped off. The list updates if other staff change orders.'] : ['No further batch remains.']),
        ...(omitted.length ? ['Files requiring attention:', ...omitted, 'Open these orders and print their existing labels individually. Do not buy replacement postage to reprint.'] : ['No carrier files were skipped in this batch.']),
        'Included files:', ...files.map(file => file.name),
    ].join('\n');
    files.push({ name: 'Label download manifest v1.txt', bytes: new TextEncoder().encode(manifest) });
    const zip = zipArchive(files, now);
    return new NextResponse(zip as unknown as BodyInit, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(zip.length),
            'Content-Disposition': contentDisposition('attachment', archiveName(now)),
            // Says what is inside without opening it, and names what did not make it, so a short
            // folder is never mistaken for the whole day's work.
            'X-Label-Count': String(prepared),
            'X-Label-Skipped': String(skipped),
            'X-Label-Total': String(total),
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
        },
    });
}
