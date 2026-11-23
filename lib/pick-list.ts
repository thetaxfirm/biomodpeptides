// Printable pick sheets for the warehouse: one order, or every order still waiting to be packed.
// Read-only. Carries what a picker needs to pull and verify stock, not the customer's contact details.
import { summaryItems } from './order-summary';
import { savedBatch } from './batch-snapshot';
import { type FulfillmentOrder } from './fulfillment';
import { tabForOrder, isArchived } from './order-queue';

export type PickOrder = FulfillmentOrder & { id: string; created: number };
export type PickLine = { name: string; detail: string; quantity: number };
export type PickEntry = { id: string; number: string; placed: number; customer: string; place: string; service: string; labelled: boolean; lines: PickLine[]; units: number };

/**
 * Everything still to be packed: paid and waiting, and labelled but not yet handed over, because a
 * label is often bought before the items are picked. Holds, internal tests, and anything already
 * moving or delivered are excluded by their bucket.
 */
export const needsPicking = (order: PickOrder) => !isArchived(order) && tabForOrder(order) === 'to_ship';
/** A single order is printable on exactly the same terms. */
export const canPick = needsPicking;

const text = (value: unknown, max = 120) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();

/**
 * What a picker needs to verify the vial in their hand: the lot, and the certificate that lot was
 * sold under.
 *
 * Deliberately not the pack size (owner, Nov 23 2026: "lets remove the 3 pack 5 pack 10 pack
 * wording on the pick list its confusing people ... i dont need to know what pack its in"). How the
 * units were priced says nothing about which box to open, and the Qty column already says how many
 * to pull. It also made the sheet wrong: the same product bought as a 5-pack and as a 10-pack read
 * as two different notes, so mergeLines kept both and printed the identical lot and COA twice.
 *
 * The customer's own receipt and the payment descriptor still carry the pack, through itemDetail in
 * order-summary. This is the warehouse copy and answers a different question.
 */
function pickDetail(item: Record<string, any> | undefined): string {
    const batch = savedBatch(item?.product?.soldBatch);
    const parts: string[] = [];
    if (batch?.lot) parts.push('Lot ' + batch.lot);
    if (batch?.coaAvailable && batch.reportId) parts.push('COA ' + batch.reportId);
    return text(parts.join(' · '), 160);
}

export function pickEntry(order: PickOrder): PickEntry {
    const data = (order.data || {}) as Record<string, any>;
    // summaryItems maps one-to-one over data.items, so the index still points at the saved line the
    // name came from. Filtered afterwards to keep that alignment.
    const saved = Array.isArray(data.items) ? data.items : [];
    const lines = summaryItems(data)
        .map((item, index) => ({ name: text(item.name), detail: pickDetail(saved[index]), quantity: item.quantity }))
        .filter(line => line.quantity > 0);
    return {
        id: order.id,
        number: orderNumber(order.id),
        placed: order.created,
        customer: text(data.address?.name) || 'Name not recorded',
        place: [text(data.address?.city, 60), text(data.address?.state, 10)].filter(Boolean).join(', '),
        service: text(data.shipment?.service || data.shippingService, 80),
        labelled: Boolean(data.shipment?.labelUrl),
        lines,
        units: lines.reduce((n, line) => n + line.quantity, 0),
    };
}

/** Oldest first: the queue is worked in the order it was earned. */
export const pickEntries = (orders: PickOrder[]) => orders.filter(needsPicking).sort((a, b) => a.created - b.created).map(pickEntry);

/**
 * One row per product. A product bought on two saved lines, or carrying two lots, is one line to
 * pick with the quantities added up; the distinct lot and certificate notes stay beside it.
 */
export function mergeLines(lines: PickLine[]): PickLine[] {
    const merged = new Map<string, { name: string; quantity: number; details: string[] }>();
    for (const line of lines) {
        const found = merged.get(line.name);
        if (found) {
            found.quantity += line.quantity;
            if (line.detail && !found.details.includes(line.detail)) found.details.push(line.detail);
        } else merged.set(line.name, { name: line.name, quantity: line.quantity, details: line.detail ? [line.detail] : [] });
    }
    return [...merged.values()]
        .map(entry => ({ name: entry.name, detail: entry.details.join(' · '), quantity: entry.quantity }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything to pull from the shelf once, before splitting it between orders. */
export const pickTotals = (entries: PickEntry[]) => mergeLines(entries.flatMap(entry => entry.lines));

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Pages fill top to bottom: an order may run over a break rather than leave a gap behind it.
// Only a single item row is kept whole, and a heading never sits alone at the foot of a page.
const STYLE = `
@page{size:portrait;margin:10mm}
*{box-sizing:border-box}
body{font:11px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#000;margin:0;padding:18px}
h1{font-size:15px;margin:0}
h2{font-size:11px;margin:0;text-transform:uppercase;letter-spacing:.05em}
.meta{color:#444;font-size:9.5px;margin:1px 0 8px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#444;border-bottom:1px solid #000;padding:0 6px 2px}
td{padding:5px 6px;border-bottom:1px solid #e0e0e0;vertical-align:top}
thead{display:table-header-group}
tr{page-break-inside:avoid;break-inside:avoid}
.qty{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700;width:34px;font-size:14px;padding-right:10px;border-right:1px solid #e0e0e0}
th.qty{font-size:8.5px;font-weight:400}
.tick{width:20px}
.tick span{display:inline-block;width:11px;height:11px;border:1px solid #555;margin-top:1px}
.name{font-weight:650}
.detail{display:block;color:#3a3a3a;font-size:9.5px;margin-top:2px}
/* Every section is a closed box, so a picker can never read a line from one order against the
   heading of another (owner, Nov 23 2026: "i need to make this very hard to mess up"). The combined
   pull is the heavier box; each order is its own. break-inside keeps a box whole on one page, and a
   box too tall for a page still breaks rather than vanishing. */
.pull{border:2px solid #000;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}
.order{border:1.5px solid #000;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid}
.pull h2,.order h2{background:#efefef;border-bottom:1.5px solid #000;padding:5px 8px;margin:0;
  /* Browsers drop background colour when printing unless told otherwise. The black rule under the
     bar carries the structure on its own, so the sheet still reads if a printer ignores this. */
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.order h2,.order .sub{page-break-after:avoid;break-after:avoid}
.order h2{display:flex;justify-content:space-between;gap:10px}
.sub{color:#333;font-size:9.5px;margin:0;padding:4px 8px 0}
/* The table runs to the box edge, so its first and last cells keep the box's own gutter. */
th:first-child,td:first-child{padding-left:8px}
th:last-child,td:last-child{padding-right:8px}
tbody tr:last-child td{border-bottom:0}
.foot{margin-top:10px;border-top:1px solid #999;padding-top:4px;font-size:9px;color:#444}
.empty{padding:14px;border:1px dashed #888;color:#444}
@media print{body{padding:0}.noprint{display:none}}
.noprint{margin-bottom:12px}
.noprint button{font:inherit;padding:6px 14px;cursor:pointer}
`;

const lineRows = (lines: PickLine[]) => lines.map(line =>
    '<tr><td class="tick"><span></span></td><td class="qty">' + line.quantity + '</td><td><span class="name">' + esc(line.name) + '</span>'
    + (line.detail ? '<span class="detail">' + esc(line.detail) + '</span>' : '') + '</td></tr>').join('');

const table = (lines: PickLine[], first: string) =>
    '<table><thead><tr><th class="tick"></th><th class="qty">Qty</th><th>' + first + '</th></tr></thead><tbody>' + lineRows(lines) + '</tbody></table>';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function orderBlock(entry: PickEntry) {
    return '<section class="order"><h2><span>' + esc(entry.number) + ' · ' + esc(entry.customer) + '</span><span>' + entry.units + 'u</span></h2>'
        + '<p class="sub">' + [entry.place, day(entry.placed), entry.service, entry.labelled ? 'label bought' : ''].filter(Boolean).map(esc).join(' · ') + '</p>'
        + (entry.lines.length ? table(mergeLines(entry.lines), 'Item') : '<p class="sub">No items recorded on this order.</p>')
        + '</section>';
}

/** One order, or the whole queue with a combined pull list first. */
export function renderPickList(entries: PickEntry[], generatedAt: number, single = false): string {
    const totals = pickTotals(entries);
    const units = totals.reduce((n, line) => n + line.quantity, 0);
    const title = single && entries[0] ? 'Pick list ' + entries[0].number : 'Pick list · ' + entries.length + ' order' + (entries.length === 1 ? '' : 's');
    const body = !entries.length
        ? '<p class="empty">Nothing is waiting to be picked right now.</p>'
        : (single ? '' : '<section class="pull"><h2>Pull from stock · all ' + entries.length + ' order'
            + (entries.length === 1 ? '' : 's') + ' together</h2>'
            // Said out loud, because picking this box AND the order boxes below would pull twice.
            + '<p class="sub">Pull this once. Then split it between the ' + entries.length + ' order'
            + (entries.length === 1 ? '' : 's') + ' below · ' + units + ' units in total.</p>'
            + table(totals, 'Product') + '</section>')
          + entries.map(orderBlock).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex"><title>' + esc(title) + ' · TryBiomod</title><style>' + STYLE + '</style></head><body>'
        + '<div class="noprint"><button type="button" onclick="window.print()">Print this sheet</button></div>'
        + '<h1>' + esc(title) + '</h1>'
        + '<p class="meta">trybiomod.com · generated ' + when(generatedAt) + (entries.length && !single ? ' · ' + units + ' units in total' : '') + '</p>'
        + body
        + '<p class="foot">Picked by ____________ · Checked by ____________ · Date ________ · '
        + 'Not a shipping confirmation: mark the order shipped in administration once the carrier has it.</p>'
        + '</body></html>';
}
