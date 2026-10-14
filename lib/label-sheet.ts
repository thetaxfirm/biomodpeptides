// Every bought-but-not-yet-handed-over label on one printable sheet, one per page.
// Read-only: it shows labels the carrier already issued and buys nothing.
import { orderBucket, type FulfillmentOrder } from './fulfillment';
import { orderNumber } from './pick-list';

export type LabelOrder = FulfillmentOrder & { id: string; created: number };
export type LabelEntry = { id: string; number: string; customer: string; place: string; service: string; tracking: string; labelUrl: string };

/** A label is "standing" once bought and before the parcel is on its way: the Label bought queue. */
export const hasStandingLabel = (order: LabelOrder) => {
    const url = (order.data as Record<string, any> | undefined)?.shipment?.labelUrl;
    return orderBucket(order) === 'label' && typeof url === 'string' && /^https:\/\//i.test(url);
};

const text = (value: unknown, max = 120) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export function labelEntry(order: LabelOrder): LabelEntry {
    const data = (order.data || {}) as Record<string, any>;
    return {
        id: order.id,
        number: orderNumber(order.id),
        customer: text(data.address?.name) || 'Name not recorded',
        place: [text(data.address?.city, 60), text(data.address?.state, 10)].filter(Boolean).join(', '),
        service: text(data.shipment?.service, 80),
        tracking: text(data.shipment?.tracking, 60),
        labelUrl: String(data.shipment.labelUrl),
    };
}

export const labelEntries = (orders: LabelOrder[]) => orders.filter(hasStandingLabel).sort((a, b) => a.created - b.created).map(labelEntry);

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const STYLE = `
*{box-sizing:border-box}
body{font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1b1b1b;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#555;font-size:12px;margin:0 0 20px}
.sheet{page-break-after:always;border-top:2px solid #333;padding-top:10px;margin-top:18px}
.sheet:last-child{page-break-after:auto}
.head{display:flex;justify-content:space-between;gap:16px;font-weight:700;margin-bottom:2px}
.sub{color:#555;font-size:12px;margin:0 0 10px;word-break:break-all}
img{max-width:100%;height:auto;border:1px solid #ccc}
.fallback{padding:14px;border:1px dashed #999;color:#555;font-size:12px}
.empty{padding:26px;border:1px dashed #999;color:#555}
.noprint{margin-bottom:16px}
.noprint button{font:inherit;padding:8px 16px;cursor:pointer}
@media print{body{padding:0}.noprint{display:none}@page{margin:8mm}}
`;

function sheet(entry: LabelEntry) {
    const alt = 'Shipping label for order ' + entry.number;
    return '<section class="sheet"><div class="head"><span>' + esc(entry.number) + '</span><span>' + esc(entry.service) + '</span></div>'
        + '<p class="sub">' + esc(entry.customer) + (entry.place ? ' · ' + esc(entry.place) : '') + (entry.tracking ? ' · ' + esc(entry.tracking) : '')
        + ' · <a href="' + esc(entry.labelUrl) + '" target="_blank" rel="noopener">open original</a></p>'
        + '<img src="' + esc(entry.labelUrl) + '" alt="' + esc(alt) + '" referrerpolicy="no-referrer"'
        + ' onerror="this.insertAdjacentHTML(\'afterend\',\'<p class=&quot;fallback&quot;>This label is not an image, so it cannot be shown here. Use the original link above to print it.</p>\');this.remove()">'
        + '</section>';
}

export function renderLabelSheet(entries: LabelEntry[], generatedAt: number): string {
    const title = 'Labels to print · ' + entries.length + ' order' + (entries.length === 1 ? '' : 's');
    const body = entries.length
        ? entries.map(sheet).join('')
        : '<p class="empty">No bought labels are waiting to be printed. Labels appear here after they are bought and before the parcel is handed to the carrier.</p>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex"><title>' + esc(title) + ' · TryBiomod</title><style>' + STYLE + '</style></head><body>'
        + '<div class="noprint"><button type="button" onclick="window.print()">Print all labels</button></div>'
        + '<h1>' + esc(title) + '</h1>'
        + '<p class="meta">trybiomod.com · generated ' + when(generatedAt) + ' · one label per page. Printing does not mark anything shipped.</p>'
        + body + '</body></html>';
}
