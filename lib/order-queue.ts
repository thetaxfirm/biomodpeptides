// Admin order queue: one short status per order, status tabs with counts, search and paging.
// Shared by the admin-orders route and the Orders tab, and the customer order list labels.
import { queueBucket, paymentVerificationFailed, type FulfillmentOrder, type OrderBucket } from './fulfillment';
import { shipDue } from './ship-cutoff';
export { orderBucket, queueBucket, dismissibleReview, flagDismissed, carrierState, bucketStatus, customerOrderStatus, type OrderBucket, type Tone } from './fulfillment';

// Work queues describe what staff need to do. Payment and parcel evidence are shown
// independently; neither a refund nor a dismissed flag can invent a carrier event.
export type QueueTab = OrderBucket | 'all' | 'archived' | 'refunded' | 'cancelled' | 'failed';
export const queueTabs: { id: QueueTab; label: string; detail: string; secondary?: boolean }[] = [
    { id: 'to_ship', label: 'Pack & ship', detail: 'Paid orders awaiting a label, packing or handoff.' },
    { id: 'review', label: 'Needs attention', detail: 'An order, payment or delivery issue needs a decision. Each row explains why.' },
    { id: 'unpaid', label: 'Payment to confirm', detail: 'Payment is not confirmed for this checkout. Check purchase and contact history before following up.' },
    { id: 'shipped', label: 'Track parcels', detail: 'Parcels handed over, moving, or with an acknowledged carrier issue. The shipment column states the evidence.' },
    { id: 'all', label: 'All orders', detail: 'Unarchived customer orders, including completed and closed orders. Internal tests are separate.' },
    { id: 'delivered', label: 'Delivered', detail: 'Delivery recorded by the carrier or store; the shipment column distinguishes them.', secondary: true },
    { id: 'refunded', label: 'Refunded', detail: 'Orders recorded as refunded. Refunds do not establish where the parcel is.', secondary: true },
    { id: 'cancelled', label: 'Cancelled', detail: 'Cancelled orders and expired checkouts. This does not mean a refund was issued.', secondary: true },
    { id: 'failed', label: 'Payment unsuccessful', detail: 'Orders recorded with an unsuccessful payment. This is separate from cancellation and refund.', secondary: true },
    { id: 'test', label: 'Internal tests', detail: 'Orders explicitly marked as internal tests.', secondary: true },
    { id: 'archived', label: 'Archived', detail: 'Filed records. Their payment and shipment history is unchanged.', secondary: true },
];
const mergedAway: Readonly<Record<string, QueueTab>> = Object.freeze({ label: 'to_ship', closed: 'all' });

/** One shared work destination for the list, counters and dashboard. */
export function tabForOrder(order: FulfillmentOrder, now = Date.now()): QueueTab {
    const bucket = queueBucket(order, now);
    if (bucket === 'test') return 'test';
    if (bucket === 'closed') return order.status === 'refunded' ? 'refunded' : order.status === 'failed' ? 'failed' : 'cancelled';
    if (paymentVerificationFailed(order)) return 'review';
    if (bucket === 'label' && Number.isFinite(order.data?.handoff?.at)) return 'shipped';
    if (bucket === 'label') return 'to_ship';
    return bucket;
}

export type QueueOrder = { id: string; owner?: string; status: string; total: number; created: number; data: Record<string, any> };
export type QueueRow = QueueOrder & { bucket: OrderBucket };
export type NoCoaRow = { id: number; name: string; lot: string | null; waitingOrders: number };
export type QueueResult = { noCoa?: NoCoaRow[]; orders: (QueueRow & { coaMissing?: string[] })[]; counts: Record<QueueTab, number>; total: number; offset: number; limit: number; hasMore: boolean; scanned: number; truncated: boolean; mustGoOut: { today: number; late: number } };

export const pageSize = 50;
export const scanLimit = 5000;

export function cleanQuery(value: unknown): string {
    return String(value ?? '').trim().replace(/^#/, '').toLowerCase().slice(0, 100);
}

function searchText(order: QueueOrder): string {
    const d = order.data || {}, a = d.address || {}, s = d.shipment || {};
    const items = Array.isArray(d.items) ? d.items.map((i: any) => i?.product?.name || '') : [];
    return [order.id, d.email, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.zip, d.tracking, s.tracking, d.promo?.code, ...items]
        .filter(Boolean).join(' ').toLowerCase();
}

/**
 * Archive is a filing step, not a status: it only takes finished orders out of the working tabs.
 * Never offered for anything that still needs money, a label, a parcel or a decision.
 */
export const archivableBuckets: OrderBucket[] = ['closed', 'delivered', 'test'];
export const canArchive = (bucket: OrderBucket) => archivableBuckets.includes(bucket);
export const isArchived = (order: { data?: Record<string, any> }) => Number.isFinite(order.data?.archivedAt);

/** Why a closed order closed, in words, when the record says. */
export function closedReason(order: { status: string; data?: Record<string, any> }): string {
    if (order.data?.releasedReason === 'unpaid_checkout_expired') return 'Never paid · checkout expired';
    if (order.status === 'refunded') return 'Refunded';
    if (order.status === 'failed') return 'Payment unsuccessful';
    return '';
}

export function isQueueTab(value: unknown): value is QueueTab {
    return queueTabs.some(t => t.id === value);
}
/** The tab to show: a current one, the tab a merged-away one became, or the default. */
export function requestedTab(value: unknown): QueueTab {
    if (isQueueTab(value)) return value;
    if (typeof value === 'string' && Object.hasOwn(mergedAway, value)) return mergedAway[value];
    return 'to_ship';
}

/**
 * rows: newest first, up to scanLimit + 1 (the extra row only signals truncation).
 * Counts ignore the search so the tabs keep showing the whole store; the list honours both.
 */
export function queryOrders(rows: QueueOrder[], params: { tab?: unknown; q?: unknown; offset?: unknown; limit?: unknown; id?: unknown }, now = Date.now()): QueueResult {
    const truncated = rows.length > scanLimit;
    const scannedRows = truncated ? rows.slice(0, scanLimit) : rows;
    // queueBucket, not orderBucket: a carrier flag the owner has already accepted stands down here
    // and nowhere else, so the customer's own order page is untouched by it.
    const tagged: QueueRow[] = scannedRows.map(o => ({ ...o, bucket: queueBucket(o, now) }));
    const counts = Object.fromEntries(queueTabs.map(t => [t.id, 0])) as Record<QueueTab, number>;
    // An archived order counts only under Archived, so the working tabs show work.
    // The 2 p.m. Pacific promise across the whole store, whichever tab is open (ship-cutoff.ts).
    const mustGoOut = { today: 0, late: 0 };
    for (const o of tagged) {
        if (isArchived(o)) { counts.archived += 1; continue; }
        const due = tabForOrder(o, now) === 'to_ship' ? shipDue(o, now) : null;
        if (due?.state === 'today') mustGoOut.today += 1; else if (due?.state === 'late') mustGoOut.late += 1;
        counts[tabForOrder(o, now)] += 1; if (o.bucket !== 'test') counts.all += 1;
    }
    const tab = requestedTab(params.tab);
    const q = cleanQuery(params.q);
    const words = q ? q.split(/\s+/) : [];
    const id = typeof params.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(params.id) ? params.id : '';
    // A single-order lookup ignores the tab so the details panel follows an order that changed state.
    let list = id ? tagged.filter(o => o.id === id)
        : tab === 'archived' ? tagged.filter(isArchived)
        : tagged.filter(o => !isArchived(o) && (tab === 'all' ? o.bucket !== 'test' : tabForOrder(o, now) === tab));
    if (words.length && !id) list = list.filter(o => { const t = searchText(o); return words.every(w => t.includes(w)); });
    // Work queues run oldest first so nothing waits behind newer orders; everything else is newest first.
    if (tab === 'to_ship') list = [...list].reverse();
    const limit = Math.min(Math.max(Number.parseInt(String(params.limit ?? pageSize), 10) || pageSize, 1), 100);
    const offset = Math.max(Number.parseInt(String(params.offset ?? 0), 10) || 0, 0);
    return { orders: list.slice(offset, offset + limit), counts, total: list.length, offset, limit, hasMore: offset + limit < list.length, scanned: scannedRows.length, truncated, mustGoOut };
}
