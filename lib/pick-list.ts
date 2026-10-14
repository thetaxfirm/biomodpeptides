// Printable pick sheets for the warehouse: one order, or every order still waiting to be packed.
// Read-only. Carries what a picker needs to pull and verify stock, not the customer's contact details.
import { summaryItems } from './order-summary';
import { orderBucket, type FulfillmentOrder } from './fulfillment';

export type PickOrder = FulfillmentOrder & { id: string; created: number };
export type PickLine = { name: string; detail: string; quantity: number };
export type PickEntry = { id: string; number: string; placed: number; customer: string; place: string; service: string; lines: PickLine[]; units: number };

/** The combined sheet covers the To ship queue only: paid, nothing picked or labelled yet. Holds and tests are excluded by their bucket. */
export const needsPicking = (order: PickOrder) => orderBucket(order) === 'to_ship';
/** A single order can still be printed once its label is bought, for a recheck while packing. */
export const canPick = (order: PickOrder) => ['to_ship', 'label'].includes(orderBucket(order));

const text = (value: unknown, max = 120) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();

export function pickEntry(order: PickOrder): PickEntry {
    const data = (order.data || {}) as Record<string, any>;
    const lines = summaryItems(data)
        .filter(item => item.quantity > 0)
        .map(item => ({ name: text(item.name), detail: text(item.detail, 160), quantity: item.quantity }));
    return {
        id: order.id,
        number: orderNumber(order.id),
        placed: order.created,
        customer: text(data.address?.name) || 'Name not recorded',
        place: [text(data.address?.city, 60), text(data.address?.state, 10)].filter(Boolean).join(', '),
        service: text(data.shipment?.service || data.shippingService, 80),
        lines,
        units: lines.reduce((n, line) => n + line.quantity, 0),
    };
}

/** Oldest first: the queue is worked in the order it was earned. */
export const pickEntries = (orders: PickOrder[]) => orders.filter(needsPicking).sort((a, b) => a.created - b.created).map(pickEntry);

/** Everything to pull from the shelf once, before splitting it between orders. */
export function pickTotals(entries: PickEntry[]): PickLine[] {
    const totals = new Map<string, PickLine>();
    for (const entry of entries) for (const line of entry.lines) {
        const key = line.name + '\u0000' + line.detail;
        const found = totals.get(key);
        if (found) found.quantity += line.quantity;
        else totals.set(key, { ...line });
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name) || a.detail.localeCompare(b.detail));
}

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const STYLE = `
*{box-sizing:border-box}
body{font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1b1b1b;margin:0;padding:28px}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 8px}
.meta{color:#555;font-size:12px;margin:0 0 20px}
table{width:100%;border-collapse:collapse;margin-bottom:10px}
th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#555;border-bottom:1.5px solid #333;padding:0 8px 4px}
td{padding:7px 8px;border-bottom:1px solid #ddd;vertical-align:top}
.qty{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700;width:60px}
.tick{width:30px}
.tick span{display:inline-block;width:15px;height:15px;border:1.5px solid #555}
.detail{display:block;font-size:11px;color:#555}
.pull{border:2px solid #333;padding:14px 16px;margin-bottom:24px}
.order{border-top:2px solid #333;padding-top:12px;margin-top:22px;page-break-inside:avoid}
.order h2{display:flex;justify-content:space-between;gap:16px}
.sub{font-size:12px;color:#555;margin:0 0 8px}
.foot{margin-top:26px;border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#555}
.empty{padding:26px;border:1px dashed #999;color:#555}
@media print{body{padding:0}.noprint{display:none}@page{margin:14mm}}
.noprint{margin-bottom:18px}
.noprint button{font:inherit;padding:8px 16px;cursor:pointer}
`;

const lineRows = (lines: PickLine[]) => lines.map(line =>
    '<tr><td class="tick"><span></span></td><td>' + esc(line.name) + (line.detail ? '<span class="detail">' + esc(line.detail) + '</span>' : '') + '</td><td class="qty">' + line.quantity + '</td></tr>').join('');

const table = (lines: PickLine[], first: string) =>
    '<table><thead><tr><th class="tick"></th><th>' + first + '</th><th class="qty">Qty</th></tr></thead><tbody>' + lineRows(lines) + '</tbody></table>';

function orderBlock(entry: PickEntry) {
    return '<section class="order"><h2><span>' + esc(entry.number) + '</span><span>' + entry.units + ' unit' + (entry.units === 1 ? '' : 's') + '</span></h2>'
        + '<p class="sub">' + esc(entry.customer) + (entry.place ? ' · ' + esc(entry.place) : '') + ' · placed ' + when(entry.placed) + (entry.service ? ' · ' + esc(entry.service) : '') + '</p>'
        + (entry.lines.length ? table(entry.lines, 'Item') : '<p class="sub">No items recorded on this order.</p>')
        + '</section>';
}

/** One order, or the whole queue with a combined pull list first. */
export function renderPickList(entries: PickEntry[], generatedAt: number, single = false): string {
    const totals = pickTotals(entries);
    const units = totals.reduce((n, line) => n + line.quantity, 0);
    const title = single && entries[0] ? 'Pick list ' + entries[0].number : 'Pick list · ' + entries.length + ' order' + (entries.length === 1 ? '' : 's');
    const body = !entries.length
        ? '<p class="empty">Nothing is waiting to be picked right now.</p>'
        : (single ? '' : '<section class="pull"><h2>Pull from stock</h2><p class="sub">Everything below covers all ' + entries.length + ' order'
            + (entries.length === 1 ? '' : 's') + ' together. Split it between the orders on the following pages.</p>' + table(totals, 'Product') + '</section>')
          + entries.map(orderBlock).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex"><title>' + esc(title) + ' · TryBiomod</title><style>' + STYLE + '</style></head><body>'
        + '<div class="noprint"><button type="button" onclick="window.print()">Print this sheet</button></div>'
        + '<h1>' + esc(title) + '</h1>'
        + '<p class="meta">trybiomod.com · generated ' + when(generatedAt) + (entries.length && !single ? ' · ' + units + ' units in total' : '') + '</p>'
        + body
        + '<p class="foot">Picked by ________________  ·  Checked by ________________  ·  Date ____________<br>'
        + 'A pick sheet is not a shipping confirmation. Mark the order shipped in administration once it is handed to the carrier.</p>'
        + '</body></html>';
}
