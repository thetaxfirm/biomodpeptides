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
export type FulfillmentOrder = { status: string; data?: { items?: unknown; internalTest?: boolean; shipment?: { status?: string; checkedAt?: number; sweptAt?: number; readFails?: number }; tracking?: string; hold?: unknown; labelCreatedAt?: number; paidAt?: number; dismissed?: { at?: number; by?: string; note?: string; carrierStatus?: string }; handoff?: { at?: number; by?: string }; labelApproval?: { cents?: number; limitCents?: number; at?: number } } };
/** A label quoted above the automatic ceiling, waiting for a person to approve the cost. */
export function awaitingLabelApproval(order: FulfillmentOrder): boolean {
    return Boolean(order.data?.labelApproval && !order.data?.shipment);
}
/**
 * A label the carrier has not scanned in this long needs a person. USPS works six days a week, so a
 * parcel handed over today is scanned by tomorrow; a day of silence means it is still on the bench,
 * or it was dropped off without an acceptance scan. Either way someone should look (owner, Oct 17 2026).
 */
export const STALLED_LABEL_MS = 24 * 3600000;
/** A parcel the carrier reported moving, then went quiet for this long, is probably stuck or lost. */
export const STUCK_IN_TRANSIT_MS = 4 * 86400000;
/**
 * A paid order that has not reached the carrier in this long needs a person, whatever the reason:
 * no postage bought, postage waiting for approval, a hold, or a box nobody posted. Measured from
 * payment rather than from the label, because the customer's clock started when they paid.
 */
export const UNSHIPPED_REMINDER_MS = 48 * 3600000;
/** When the order was paid for, falling back to when it was placed on records written before paidAt. */
export function paidAt(order: FulfillmentOrder & { created?: number }): number | null {
    const stamped = order.data?.paidAt;
    if (typeof stamped === 'number' && Number.isFinite(stamped)) return stamped;
    return typeof order.created === 'number' && Number.isFinite(order.created) ? order.created : null;
}
/** Paid, still not handed to the carrier, and past the reminder window. */
export function unshippedTooLong(order: FulfillmentOrder & { created?: number }, now = Date.now()): boolean {
    if (order.status !== 'paid' && order.status !== 'labeling') return false;
    const since = paidAt(order);
    return since !== null && now - since > UNSHIPPED_REMINDER_MS;
}
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
/**
 * The carrier has refused to tell us about this parcel several runs in a row. It looks identical to
 * an unscanned parcel but the cause is at the provider, not the post office, so the team should be
 * sent to the label rather than to the box. Three runs, so one outage does not accuse a good parcel.
 */
export const UNREADABLE_AFTER = 3;
export function unreadableParcel(order: FulfillmentOrder): boolean {
    const fails = order.data?.shipment?.readFails;
    return typeof fails === 'number' && fails >= UNREADABLE_AFTER;
}
const moving = new Set(['in_transit', 'out_for_delivery', 'available_for_pickup']);
/** Moving, but the carrier's last event is days old. checkedAt is the carrier's own event time. */
export function stuckInTransit(order: FulfillmentOrder, now = Date.now()): boolean {
    const s = order.data?.shipment, last = s?.checkedAt;
    if (!s?.status || !moving.has(s.status) || typeof last !== 'number' || !Number.isFinite(last)) return false;
    return now - last > STUCK_IN_TRANSIT_MS;
}
/** Carrier status in plain words for staff. Never claims a scan the carrier has not reported. */
export const carrierWords: Record<string, string> = {
    unknown: 'Not scanned by carrier yet', pre_transit: 'Not scanned by carrier yet', in_transit: 'In transit',
    out_for_delivery: 'Out for delivery', available_for_pickup: 'At the post office for pickup', delivered: 'Delivered',
    return_to_sender: 'Returning to sender', failure: 'Delivery failed', cancelled: 'Label cancelled', error: 'Carrier error',
};
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
    if (stuckInTransit(order, now)) return 'review';
    if (carrier && moving.has(carrier)) return 'shipped';
    if (order.status === 'labeling' || (order.data?.shipment && ['paid', 'shipped'].includes(order.status))) return 'label';
    if (order.status === 'shipped') return 'shipped';
    if (order.status === 'paid') return 'to_ship';
    if (['creating', 'awaiting_payment', 'pending'].includes(order.status)) return 'unpaid';
    return 'review';
}

/** What the carrier last said about this parcel, as a plain string. '' when it has said nothing. */
export const carrierState = (order: FulfillmentOrder): string => String(order.data?.shipment?.status || '');

/**
 * The three Needs review reasons that come from the carrier rather than from a decision: not scanned,
 * no update in four days, and a carrier problem. These are the ones that can sit in the tab forever
 * with no button to clear them, because only the carrier can clear them. A hold, a label over the
 * limit and a payment that needs checking each have their own button and a real decision behind
 * them, so none of those is dismissible (owner, Oct 20 2026).
 */
export function dismissibleReview(order: FulfillmentOrder, now = Date.now()): boolean {
    return orderBucket(order, now) === 'review' && !order.data?.hold && !awaitingLabelApproval(order) && Boolean(order.data?.shipment);
}
/**
 * A carrier flag the owner has looked at and accepted. The dismissal is tied to the carrier status
 * it was given for, never to the order: if the carrier later says something different — including a
 * new problem — it stops matching and the order returns to Needs review on its own.
 */
export function flagDismissed(order: FulfillmentOrder): boolean {
    const d = order.data?.dismissed;
    return Boolean(d) && typeof d?.at === 'number' && Number.isFinite(d.at) && d.carrierStatus === carrierState(order);
}
/**
 * The admin queue's bucket: orderBucket(), with an accepted carrier flag standing down. A dismissed
 * order goes to Shipped rather than back into To ship, because the parcel is with the carrier and
 * the only thing that changed is that nobody needs to be told about it again. Its real carrier
 * status still prints on the row. The customer's own view never consults this.
 */
export function queueBucket(order: FulfillmentOrder, now = Date.now()): OrderBucket {
    const bucket = orderBucket(order, now);
    return bucket === 'review' && flagDismissed(order) && dismissibleReview(order, now) ? 'shipped' : bucket;
}

/** Customer-facing short status. Never claims a carrier event the carrier has not reported. */
export function customerOrderStatus(order: FulfillmentOrder): { label: string; tone: Tone } {
    let bucket = orderBucket(order);
    // Unscanned and stuck parcels are a flag for staff, not news for the customer.
    if (bucket === 'review' && !order.data?.hold && !awaitingLabelApproval(order)) {
        const carrier = order.data?.shipment?.status;
        if (stuckInTransit(order)) bucket = 'shipped';
        else if (stalledLabel(order)) bucket = order.status === 'shipped' ? 'shipped' : 'label';
        else if (carrier && moving.has(carrier)) bucket = 'shipped';
    }
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
