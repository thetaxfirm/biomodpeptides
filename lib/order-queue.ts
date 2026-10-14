// Admin order queue: one short status per order, status tabs with counts, search and paging.
// Shared by the admin-orders route and the Orders tab, and the customer order list labels.
import { orderBucket, type FulfillmentOrder, type OrderBucket } from './fulfillment';
export { orderBucket, bucketStatus, customerOrderStatus, type OrderBucket, type Tone } from './fulfillment';

// Tab order is the order of work: what needs doing first comes first.
export type QueueTab = OrderBucket | 'all';
export const queueTabs: { id: QueueTab; label: string }[] = [
    { id: 'to_ship', label: 'To ship' },
    { id: 'label', label: 'Label bought' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'unpaid', label: 'Unpaid' },
    { id: 'review', label: 'Needs review' },
    { id: 'closed', label: 'Refunded / cancelled' },
    { id: 'all', label: 'All' },
    { id: 'test', label: 'Internal tests' },
];

export type QueueOrder = { id: string; owner?: string; status: string; total: number; created: number; data: Record<string, any> };
export type QueueRow = QueueOrder & { bucket: OrderBucket };
export type NoCoaRow = { id: number; name: string; lot: string | null; waitingOrders: number };
export type QueueResult = { noCoa?: NoCoaRow[]; orders: (QueueRow & { coaMissing?: string[] })[]; counts: Record<QueueTab, number>; total: number; offset: number; limit: number; hasMore: boolean; scanned: number; truncated: boolean };

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

export function isQueueTab(value: unknown): value is QueueTab {
    return queueTabs.some(t => t.id === value);
}

/**
 * rows: newest first, up to scanLimit + 1 (the extra row only signals truncation).
 * Counts ignore the search so the tabs keep showing the whole store; the list honours both.
 */
export function queryOrders(rows: QueueOrder[], params: { tab?: unknown; q?: unknown; offset?: unknown; limit?: unknown; id?: unknown }): QueueResult {
    const truncated = rows.length > scanLimit;
    const scannedRows = truncated ? rows.slice(0, scanLimit) : rows;
    const tagged: QueueRow[] = scannedRows.map(o => ({ ...o, bucket: orderBucket(o) }));
    const counts = Object.fromEntries(queueTabs.map(t => [t.id, 0])) as Record<QueueTab, number>;
    for (const o of tagged) { counts[o.bucket] += 1; if (o.bucket !== 'test') counts.all += 1; }
    const tab: QueueTab = isQueueTab(params.tab) ? params.tab : 'to_ship';
    const q = cleanQuery(params.q);
    const words = q ? q.split(/\s+/) : [];
    const id = typeof params.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(params.id) ? params.id : '';
    // A single-order lookup ignores the tab so the details panel follows an order that changed state.
    let list = id ? tagged.filter(o => o.id === id) : tagged.filter(o => tab === 'all' ? o.bucket !== 'test' : o.bucket === tab);
    if (words.length && !id) list = list.filter(o => { const t = searchText(o); return words.every(w => t.includes(w)); });
    // Work queues run oldest first so nothing waits behind newer orders; everything else is newest first.
    if (tab === 'to_ship' || tab === 'label') list = [...list].reverse();
    const limit = Math.min(Math.max(Number.parseInt(String(params.limit ?? pageSize), 10) || pageSize, 1), 100);
    const offset = Math.max(Number.parseInt(String(params.offset ?? 0), 10) || 0, 0);
    return { orders: list.slice(offset, offset + limit), counts, total: list.length, offset, limit, hasMore: offset + limit < list.length, scanned: scannedRows.length, truncated };
}
