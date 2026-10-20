// Admin order queue: one short status per order, status tabs with counts, search and paging.
// Shared by the admin-orders route and the Orders tab, and the customer order list labels.
import { orderBucket, type FulfillmentOrder, type OrderBucket } from './fulfillment';
import { shipDue } from './ship-cutoff';
export { orderBucket, bucketStatus, customerOrderStatus, type OrderBucket, type Tone } from './fulfillment';

// Tab order is the order of work: what needs doing first comes first.
//
// A tab is a place to work, not a status. Several statuses share one where the work is the same:
// an order waiting for a label and one whose label is already bought are both "get it out the
// door", and a parcel in transit and one that arrived are both gone. Splitting those meant two
// tabs to watch for one job. Each row still shows its own status in the Status column, so nothing
// is lost by grouping them, and orderBucket() stays as precise as it ever was.
// QueueTab stays wide because it is also what arrives from a saved view or an old link, and those
// can still name a tab that has since been merged away. requestedTab() narrows anything to a tab
// that exists; tabBuckets below is the list of tabs actually shown.
export type QueueTab = OrderBucket | 'all' | 'archived';
export const tabBuckets = {
    to_ship: ['to_ship', 'label'],
    shipped: ['shipped', 'delivered'],
    unpaid: ['unpaid'],
    review: ['review'],
    closed: ['closed'],
    test: ['test'],
} as const satisfies Partial<Record<QueueTab, readonly OrderBucket[]>>;
type WorkTab = keyof typeof tabBuckets;
export const queueTabs: { id: QueueTab; label: string }[] = [
    { id: 'to_ship', label: 'To ship' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'unpaid', label: 'Unpaid' },
    { id: 'review', label: 'Needs review' },
    { id: 'closed', label: 'Refunded / cancelled' },
    { id: 'all', label: 'All' },
    { id: 'test', label: 'Internal tests' },
    { id: 'archived', label: 'Archived' },
];
/** The tab an order shows up under, from its own status. */
export function tabForBucket(bucket: OrderBucket): WorkTab {
    for (const tab of Object.keys(tabBuckets) as WorkTab[]) if ((tabBuckets[tab] as readonly OrderBucket[]).includes(bucket)) return tab;
    return 'review';
}
/** Tabs that used to stand alone. A saved view or an old link still lands where that work moved. */
const mergedAway: Readonly<Record<string, QueueTab>> = Object.freeze({ label: 'to_ship', delivered: 'shipped' });

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
    const tagged: QueueRow[] = scannedRows.map(o => ({ ...o, bucket: orderBucket(o) }));
    const counts = Object.fromEntries(queueTabs.map(t => [t.id, 0])) as Record<QueueTab, number>;
    // An archived order counts only under Archived, so the working tabs show work.
    // The 2 p.m. Pacific promise across the whole store, whichever tab is open (ship-cutoff.ts).
    const mustGoOut = { today: 0, late: 0 };
    for (const o of tagged) {
        if (isArchived(o)) { counts.archived += 1; continue; }
        const due = shipDue(o, now);
        if (due?.state === 'today') mustGoOut.today += 1; else if (due?.state === 'late') mustGoOut.late += 1;
        counts[tabForBucket(o.bucket)] += 1; if (o.bucket !== 'test') counts.all += 1;
    }
    const tab = requestedTab(params.tab);
    const q = cleanQuery(params.q);
    const words = q ? q.split(/\s+/) : [];
    const id = typeof params.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(params.id) ? params.id : '';
    // A single-order lookup ignores the tab so the details panel follows an order that changed state.
    let list = id ? tagged.filter(o => o.id === id)
        : tab === 'archived' ? tagged.filter(isArchived)
        : tagged.filter(o => !isArchived(o) && (tab === 'all' ? o.bucket !== 'test' : ((tabBuckets[tab as WorkTab] ?? []) as readonly OrderBucket[]).includes(o.bucket)));
    if (words.length && !id) list = list.filter(o => { const t = searchText(o); return words.every(w => t.includes(w)); });
    // Work queues run oldest first so nothing waits behind newer orders; everything else is newest first.
    if (tab === 'to_ship') list = [...list].reverse();
    const limit = Math.min(Math.max(Number.parseInt(String(params.limit ?? pageSize), 10) || pageSize, 1), 100);
    const offset = Math.max(Number.parseInt(String(params.offset ?? 0), 10) || 0, 0);
    return { orders: list.slice(offset, offset + limit), counts, total: list.length, offset, limit, hasMore: offset + limit < list.length, scanned: scannedRows.length, truncated, mustGoOut };
}
