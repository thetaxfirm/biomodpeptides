// Label and delivery in plain words, for every place staff open an order or a customer: the Orders
// table, the order panel and the reply desk. Owner, Nov 8 2026: "there is no way to look and see
// the labels and if they have been delivered. add that for all customers."
// Read-only. It reports what the store and the carrier recorded and never claims more.
import { carrierWords, orderShipmentStatus, type FulfillmentOrder } from './fulfillment';

type Order = FulfillmentOrder & { id?: string; data?: FulfillmentOrder['data'] & Record<string, any> };

export type LabelSummary =
    | { state: 'bought'; service: string; tracking: string; labelUrl: string | null; trackingUrl: string | null; boughtAt: number | null; protection: string; carrier: string; carrierAt: number | null; delivered: boolean; problem: boolean }
    | { state: 'missing' | 'buying' | 'manual' | 'none'; words: string; tracking?: string };

const https = (v: unknown) => typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim() : null;
const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
const PAID = new Set(['paid', 'labeling', 'shipped', 'delivered']);
const CARRIER_PROBLEMS = new Set(['return_to_sender', 'failure', 'cancelled', 'error']);

/** The admin Track page: carrier scans beside the label, ready to copy into an email. */
export const trackPageUrl = (orderId: string) => '/api/admin/parcel?id=' + encodeURIComponent(orderId);

/** Whether a postage label exists, where to open it, and what the carrier last said about it. */
export function labelSummary(order: Order): LabelSummary {
    const d = (order.data || {}) as Record<string, any>, s = d.shipment as Record<string, any> | undefined;
    if (s && (s.tracking || s.labelUrl)) {
        const status = typeof s.status === 'string' ? s.status : '';
        const cents = Number(s.insuredCents);
        return {
            state: 'bought',
            service: String(s.service || s.carrier || 'Carrier label'),
            tracking: String(s.tracking || ''),
            labelUrl: https(s.labelUrl),
            trackingUrl: https(s.trackingUrl),
            boughtAt: time(d.labelCreatedAt),
            protection: [cents > 0 ? 'Insured $' + (cents / 100).toFixed(2) : '', s.signature ? 'Signature required' : ''].filter(Boolean).join(' · '),
            carrier: status ? carrierWords[status] || status.replaceAll('_', ' ') : 'No carrier update yet',
            carrierAt: time(s.checkedAt),
            delivered: status === 'delivered',
            problem: CARRIER_PROBLEMS.has(status),
        };
    }
    if (order.status === 'labeling') return { state: 'buying', words: 'Label purchase in progress' };
    const manual = typeof d.tracking === 'string' ? d.tracking.trim() : '';
    if (manual && ['shipped', 'delivered'].includes(order.status)) return { state: 'manual', words: 'No store label. Shipped by hand', tracking: manual };
    if (PAID.has(order.status)) return { state: 'missing', words: order.status === 'paid' ? 'No label bought yet' : 'Marked ' + order.status + ', but no label is on file' };
    return { state: 'none', words: 'No label. Order not paid' };
}

/** The one thing to do next, in words, for read-only views that cannot show the action buttons. */
export function nextStepWords(order: Order): string {
    const d = (order.data || {}) as Record<string, any>, label = labelSummary(order);
    if (d.internalTest) return 'Internal test. Nothing to do';
    if (['refunded', 'cancelled', 'canceled'].includes(order.status)) return 'Closed. Nothing to do';
    if (d.hold) return 'On hold. Solve the problem, then clear the hold';
    if (!PAID.has(order.status)) return order.status === 'review' ? 'Review the payment' : 'Payment not confirmed. Check payment';
    if (label.state === 'missing') return order.status === 'paid' ? 'Buy the label and ship' : 'Find the label or tracking for this order';
    if (label.state === 'buying') return 'Wait for the label purchase';
    if (label.state === 'manual') return order.status === 'delivered' ? 'Nothing to do' : 'Track the parcel by hand';
    if (label.state !== 'bought') return 'View the order';
    if (label.delivered) return 'Delivered. Nothing to do';
    if (label.problem) return 'Carrier could not deliver. Call the carrier and contact the customer';
    if (orderShipmentStatus(order).label === 'Label ready') return 'Pack, drop off, then mark Dropped off';
    return 'Track the parcel';
}
