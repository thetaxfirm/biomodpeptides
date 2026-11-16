// Which bought-but-not-yet-handed-over labels are waiting, and how each one is described.
// Read-only: it names labels the carrier already issued and buys nothing.
//
// This used to render a printable HTML sheet too. It was replaced on Nov 16 2026 by a zip of
// individual borderless 4x6 PDFs (lib/label-archive.ts): the sheet printed bordered and scaled,
// which is no use on a label printer.
import { orderBucket, type FulfillmentOrder } from './fulfillment';
import { tabForOrder, isArchived } from './order-queue';
import { orderNumber } from './pick-list';

export type LabelOrder = FulfillmentOrder & { id: string; created: number };
export type LabelEntry = { id: string; number: string; customer: string; place: string; service: string; tracking: string; labelUrl: string };

/** A label is "standing" once bought and before the parcel is on its way: the Label bought queue. */
export const hasStandingLabel = (order: LabelOrder) => {
    const url = (order.data as Record<string, any> | undefined)?.shipment?.labelUrl;
    return !isArchived(order) && tabForOrder(order) === 'to_ship' && orderBucket(order) === 'label' && typeof url === 'string' && /^https:\/\//i.test(url);
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
