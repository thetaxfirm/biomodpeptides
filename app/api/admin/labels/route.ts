import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { all, parse, timestamp } from '@/lib/runtime';
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
export async function GET(_req: NextRequest) {
    try { await requireStaff('orders:fulfill'); }
    catch { return NextResponse.json({ error: 'Administrator sign-in required.' }, { status: 403 }); }

    type Row = { id: string; status: string; data: string; created: number };
    const rows = await all<Row>("SELECT id,status,data,created FROM orders WHERE status IN ('paid','shipped') AND json_extract(data,'$.shipment.labelUrl') IS NOT NULL ORDER BY created ASC LIMIT 200");
    const orders: LabelOrder[] = rows.map(row => ({ id: row.id, status: row.status, created: row.created, data: parse<Record<string, any>>(row.data, {}) }));
    const waiting = labelEntries(orders).slice(0, MAX_LABELS);
    if (!waiting.length)
        return NextResponse.json({ error: 'No bought labels are waiting. Buy a label from an order first.' }, { status: 404 });

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
        for (const file of batch) { if (file) files.push(file); else skipped++; }
    }
    if (!files.length)
        return NextResponse.json({ error: 'No waiting label could be fetched from the carrier. Open an order and print its label from there.' }, { status: 502 });

    const now = timestamp();
    const zip = zipArchive(files, now);
    return new NextResponse(zip as unknown as BodyInit, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(zip.length),
            'Content-Disposition': contentDisposition('attachment', archiveName(now)),
            // Says what is inside without opening it, and names what did not make it, so a short
            // folder is never mistaken for the whole day's work.
            'X-Label-Count': String(files.length),
            'X-Label-Skipped': String(skipped),
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
        },
    });
}
