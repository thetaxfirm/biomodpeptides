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
    return 'Preorder: estimated dispatch ' + estimates.join(' / ') + '. All items in this order ship together when ready. Timing may change; this is not an immediate shipment.';
}

/** Payment status is not proof of physical dispatch. Shared by admin and customer views. */
export type FulfillmentOrder = { status: string; data?: { items?: unknown; internalTest?: boolean; shipment?: { status?: string; checkedAt?: number }; tracking?: string } };
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
