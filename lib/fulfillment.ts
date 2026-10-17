/** Read only the saved purchase snapshot, never today's catalog or settings. */
export type SavedPreorder = { percentOff: number; ships: string; basePrice: number };
export function savedPreorder(value: unknown): SavedPreorder | null {
    if (!value || typeof value !== 'object') return null;
    const p = value as Record<string, unknown>;
    if (typeof p.percentOff !== 'number' || !Number.isFinite(p.percentOff) || p.percentOff <= 0 || p.percentOff >= 100 || typeof p.ships !== 'string' || !p.ships.trim() || p.ships.length > 120 || !Number.isSafeInteger(p.basePrice) || Number(p.basePrice) < 1) return null;
    return { percentOff: p.percentOff, ships: p.ships, basePrice: p.basePrice as number };
}
export function orderHasPreorder(data: { items?: unknown } | undefined): boolean {
    return Array.isArray(data?.items) && data.items.some(item => Boolean(savedPreorder(item?.product?.activePreorder)));
}
export function orderPreorderNotice(data: { items?: unknown } | undefined): string {
    if (!Array.isArray(data?.items)) return '';
    const estimates = [...new Set(data.items.map(item => savedPreorder(item?.product?.activePreorder)?.ships).filter((value): value is string => Boolean(value)))];
    if (!estimates.length) return '';
    return 'Preorder: estimated dispatch ' + estimates.join(' / ') + '. Ships when the preorder is ready. Timing may change; this is not an immediate shipment.';
}

/** Payment status is not proof of physical dispatch. Shared by admin and customer views. */
export type FulfillmentOrder = { status: string; data?: { items?: unknown; internalTest?: boolean; shipment?: { status?: string; checkedAt?: number }; tracking?: string; hold?: unknown; labelCreatedAt?: number; labelApproval?: { cents?: number; limitCents?: number; at?: number } } };
/** A label quoted above the automatic ceiling, waiting for a person to approve the cost. */
export function awaitingLabelApproval(order: FulfillmentOrder): boolean {
    return Boolean(order.data?.labelApproval && !order.data?.shipment);
}
/** A label the carrier has not scanned in this long was probably never handed over. */
export const STALLED_LABEL_MS = 48 * 3600000;
/**
 * Bought, but the carrier has never reported it moving. Automatic purchase makes this likelier:
 * nobody consciously handled the order, so nobody notices the parcel still sitting on the bench.
 */
export function stalledLabel(order: FulfillmentOrder, now = Date.now()): boolean {
    const created = order.data?.labelCreatedAt;
    if (!order.data?.shipment || typeof created !== 'number' || !Number.isFinite(created)) return false;
    const carrier = order.data.shipment.status;
    if (carrier && carrier !== 'pre_transit' && carrier !== 'unknown') return false;
    return now - created > STALLED_LABEL_MS;
}
const moving = new Set(['in_transit', 'out_for_delivery', 'available_for_pickup']);
const problems = new Set(['return_to_sender', 'failure', 'cancelled', 'error']);
export function fulfillmentLabel(order: FulfillmentOrder): string {
    if (order.data?.internalTest) return 'Internal test: not a customer sale';
    if (['refunded','cancelled','canceled','failed'].includes(order.status)) return ({refunded:'Refunded',cancelled:'Cancelled',canceled:'Cancelled',failed:'Payment unsuccessful'} as Record<string,string>)[order.status];
    const carrier = order.data?.shipment?.status;
    if (carrier === 'delivered') return 'Delivered: confirmed by carrier';
    if (carrier && moving.has(carrier)) return ({ in_transit: 'In transit: confirmed by carrier', out_for_delivery: 'Out for delivery', available_for_pickup: 'Available for recipient pickup' } as Record<string, string>)[carrier];
    if (carrier && problems.has(carrier)) return 'Carrier reports ' + carrier.replaceAll('_', ' ') + ': review required';
    if (order.status === 'delivered') return 'Marked delivered by store; carrier delivery unconfirmed';
    if (order.data?.shipment) return 'Label created: awaiting carrier acceptance';
    if (awaitingLabelApproval(order)) return 'Label costs more than the automatic limit: your approval required';
    if (order.status === 'shipped') return 'Marked dispatched by store; carrier acceptance unconfirmed';
    if (order.status === 'paid') return orderPreorderNotice(order.data) ? 'Payment confirmed. ' + orderPreorderNotice(order.data) : 'Payment confirmed: awaiting packing and dispatch';
    if (order.status === 'labeling') return 'Preparing shipment: label purchase in progress';
    return ({ creating: 'Checkout being prepared', awaiting_payment: 'Unpaid checkout: payment not confirmed', pending: 'Payment not confirmed: needs verification', review: 'Payment requires review', cancelled: 'Cancelled', canceled: 'Cancelled', refunded: 'Refunded', failed: 'Payment unsuccessful' } as Record<string, string>)[order.status] || order.status.replaceAll('_', ' ');
}
export function needsFulfillmentAttention(order: FulfillmentOrder): boolean {
    if (order.data?.internalTest) return false;
    if (!['paid', 'labeling', 'shipped', 'delivered'].includes(order.status)) return false;
    const carrier = order.data?.shipment?.status;
    if (carrier === 'delivered' || (carrier && moving.has(carrier))) return false;
    return true;
}
export function shipmentEmailText(status: string): string {
    if (status === 'delivered') return 'The carrier reports that your package was delivered.';
    if (moving.has(status)) return 'The carrier reports: ' + status.replaceAll('_', ' ') + '.';
    if (problems.has(status)) return 'The carrier reports ' + status.replaceAll('_', ' ') + '. Please check tracking for details.';
    return 'A shipping label has been created. Carrier acceptance has not been confirmed. Tracking will update when the carrier scans your package.';
}

// Short status: one state per order for the admin queue and the customer order list.
export type OrderBucket = 'to_ship' | 'label' | 'shipped' | 'delivered' | 'unpaid' | 'review' | 'closed' | 'test';
export type QueueTab = OrderBucket | 'all' | 'archived';
export type Tone = 'action' | 'progress' | 'done' | 'waiting' | 'problem' | 'muted';

export const bucketStatus: Record<OrderBucket, { label: string; tone: Tone }> = {
    to_ship: { label: 'To ship', tone: 'action' },
    label: { label: 'Label bought', tone: 'progress' },
    shipped: { label: 'Shipped', tone: 'progress' },
    delivered: { label: 'Delivered', tone: 'done' },
    unpaid: { label: 'Unpaid', tone: 'waiting' },
    review: { label: 'Needs review', tone: 'problem' },
    closed: { label: 'Refunded / cancelled', tone: 'muted' },
    test: { label: 'Internal test', tone: 'muted' },
};

/** Same rules as fulfillmentLabel(), reduced to one state per order. */
export function orderBucket(order: FulfillmentOrder, now = Date.now()): OrderBucket {
    if (order.data?.internalTest) return 'test';
    if (['refunded', 'cancelled', 'canceled', 'failed'].includes(order.status)) return 'closed';
    const carrier = order.data?.shipment?.status;
    // Problems outrank delivery. A parcel the carrier later returns or fails to deliver is a refund and
    // a lost shipment, so it must not disappear into Delivered just because it once arrived.
    if (carrier && problems.has(carrier)) return 'review';
    if (carrier === 'delivered' || order.status === 'delivered') return 'delivered';
    // A reported problem (for example, the item is not in stock yet) holds the order in Needs review
    // until cleared. It does not hide a delivery that already happened.
    if (order.data?.hold) return 'review';
    // A label priced above the automatic ceiling waits for a person, in the same place they already
    // look for work that needs them. Unlike a hold, every manual action stays available.
    if (awaitingLabelApproval(order)) return 'review';
    // A label nobody ever handed to the carrier needs a human, not another day of waiting.
    if (stalledLabel(order, now)) return 'review';
    if (carrier && moving.has(carrier)) return 'shipped';
    if (order.status === 'labeling' || (order.data?.shipment && ['paid', 'shipped'].includes(order.status))) return 'label';
    if (order.status === 'shipped') return 'shipped';
    if (order.status === 'paid') return 'to_ship';
    if (['creating', 'awaiting_payment', 'pending'].includes(order.status)) return 'unpaid';
    return 'review';
}

/** Customer-facing short status. Never claims a carrier event the carrier has not reported. */
export function customerOrderStatus(order: FulfillmentOrder): { label: string; tone: Tone } {
    const bucket = orderBucket(order);
    return ({
        to_ship: { label: 'Processing', tone: 'progress' },
        label: { label: 'Preparing shipment', tone: 'progress' },
        shipped: { label: 'Shipped', tone: 'progress' },
        delivered: { label: 'Delivered', tone: 'done' },
        unpaid: { label: 'Awaiting payment', tone: 'waiting' },
        review: { label: 'Under review', tone: 'problem' },
        closed: { label: order.status === 'refunded' ? 'Refunded' : order.status === 'failed' ? 'Payment unsuccessful' : 'Cancelled', tone: 'muted' },
        test: { label: 'Test order', tone: 'muted' },
    } as Record<OrderBucket, { label: string; tone: Tone }>)[bucket];
}
