// "Today" home for administration: what needs doing now, how sales are going, and store setup gaps.
// Every number reuses the rule that already drives its own tab (order buckets, the reply desk's
// overdue list, the no-COA shipping block), so this page can never disagree with the tab it links to.
import type { Product } from './catalog';
import { hasCoa, noCoaProducts } from './coa-shipping';
import { orderBucket, type OrderBucket } from './fulfillment';
import { overdueCustomers } from './reply-overdue';
import type { CoaEnvironment } from './coa-outbox';
import type { ShippingOptionsConfig } from './shipping-options';

const DAY = 86400000;
const PAID: OrderBucket[] = ['to_ship', 'label', 'shipped', 'delivered'];
export type OverviewOrder = { id: string; status: string; total: number; created: number; data: Record<string, any> };
export type Attention = { id: string; tab: string; count: number; title: string; detail: string; tone: 'urgent' | 'normal' };
export type SalesWindow = { label: string; orders: number; revenue: number };
export type Overview = { generatedAt: number; attention: Attention[]; sales: SalesWindow[] | null; setup: Attention[] };
export type OverviewAccess = { orders: boolean; requests: boolean; reports: boolean; store: boolean };

const pacificMidnight = (now: number) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    // Offset of Pacific time at that date, from its noon (never inside a DST jump).
    const noon = Date.parse(day + 'T12:00:00Z');
    const pacificNoonHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(noon)) % 24;
    return Date.parse(day + 'T00:00:00Z') + (12 - pacificNoonHour) * 3600000;
};
const ago = (now: number, since: number) => { const d = Math.floor((now - since) / DAY); return d < 1 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

export function orderAttention(orders: OverviewOrder[], products: Product[], now: number): Attention[] {
    const out: Attention[] = [];
    const bucketed = orders.map(o => ({ ...o, bucket: orderBucket(o as any) }));
    const toShip = bucketed.filter(o => o.bucket === 'to_ship');
    if (toShip.length) {
        const blocked = toShip.filter(o => (Array.isArray(o.data?.items) ? o.data.items : []).some((i: any) => !hasCoa(products.find(p => p.id === Number(i?.id ?? i?.product?.id)))));
        const oldest = Math.min(...toShip.map(o => o.created));
        out.push({ id: 'to_ship', tab: 'orders', count: toShip.length, tone: now - oldest > 2 * DAY ? 'urgent' : 'normal', title: plural(toShip.length, 'paid order') + ' to ship',
            detail: `Oldest waiting ${ago(now, oldest)}.` + (blocked.length ? ` ${blocked.length} can't ship until a COA is attached.` : '') });
    }
    const label = bucketed.filter(o => o.bucket === 'label');
    if (label.length) out.push({ id: 'label', tab: 'orders', count: label.length, tone: 'normal', title: plural(label.length, 'label') + ' bought, not yet marked shipped', detail: 'Pack these and hand them to the carrier.' });
    const review = bucketed.filter(o => o.bucket === 'review');
    if (review.length) out.push({ id: 'review', tab: 'orders', count: review.length, tone: 'urgent', title: (review.length === 1 ? '1 order needs' : review.length + ' orders need') + ' review', detail: 'Payment or checkout needs a decision before anything ships.' });
    const unpaid = bucketed.filter(o => o.bucket === 'unpaid' && now - o.created <= 7 * DAY);
    if (unpaid.length) out.push({ id: 'unpaid', tab: 'orders', count: unpaid.length, tone: 'normal', title: plural(unpaid.length, 'unfinished checkout') + ' this week', detail: 'Customers started paying but did not finish. A win-back email can recover them.' });
    return out;
}

export function productAttention(products: Product[], waitingOrders: { items: unknown }[]): Attention[] {
    const out: Attention[] = [];
    const selling = products.filter(p => p.purchasable !== false && p.inStock !== false && (p as any).availability !== 'sold_out');
    const blocked = noCoaProducts(selling, waitingOrders).filter(p => p.waitingOrders > 0);
    if (blocked.length) out.push({ id: 'coa_blocked', tab: 'products', count: blocked.length, tone: 'urgent', title: plural(blocked.length, 'product') + ' holding up paid orders: no COA', detail: blocked.slice(0, 4).map(p => p.name).join(', ') + (blocked.length > 4 ? ` and ${blocked.length - 4} more` : '') + '. Attach the COA to release them.' });
    const out0 = selling.filter(p => p.stockQuantity != null && p.stockQuantity <= 0);
    if (out0.length) out.push({ id: 'out_of_stock', tab: 'products', count: out0.length, tone: 'urgent', title: plural(out0.length, 'product') + ' out of stock', detail: out0.slice(0, 4).map(p => p.name).join(', ') + '.' });
    const low = selling.filter(p => p.stockQuantity != null && p.stockQuantity > 0 && p.stockQuantity <= 5);
    if (low.length) out.push({ id: 'low_stock', tab: 'products', count: low.length, tone: 'normal', title: plural(low.length, 'product') + ' low on stock (5 or fewer)', detail: low.slice(0, 4).map(p => `${p.name} (${p.stockQuantity})`).join(', ') + '.' });
    const noCoa = noCoaProducts(selling).length;
    if (noCoa) out.push({ id: 'no_coa', tab: 'products', count: noCoa, tone: 'normal', title: plural(noCoa, 'product') + ' for sale without a COA', detail: "Customers can order these, but they can't ship until the COA for the current lot is attached." });
    return out;
}

export function salesWindows(orders: OverviewOrder[], now: number, environment: string | undefined): SalesWindow[] {
    const paid = orders.filter(o => PAID.includes(orderBucket(o as any)) && (!environment || !o.data?.environment || o.data.environment === environment));
    const since = (from: number) => { const rows = paid.filter(o => o.created >= from); return { orders: rows.length, revenue: rows.reduce((s, o) => s + (Number.isSafeInteger(o.total) ? o.total : 0), 0) }; };
    return [{ label: 'Today', ...since(pacificMidnight(now)) }, { label: 'Last 7 days', ...since(now - 7 * DAY) }, { label: 'Last 30 days', ...since(now - 30 * DAY) }];
}

export function setupAttention(shipping: ShippingOptionsConfig, environment: string | undefined): Attention[] {
    const out: Attention[] = [];
    if (!shipping.services) out.push({ id: 'shipping', tab: 'settings', count: 1, tone: 'urgent', title: 'Shipping prices are not set up', detail: 'Checkout charges the bare carrier rate with nothing added. Choose services and your extra charge in Settings.' });
    else if (!shipping.services.some(s => s.enabled)) out.push({ id: 'shipping_off', tab: 'settings', count: 1, tone: 'urgent', title: 'Every shipping service is turned off', detail: 'Customers cannot check out until at least one service is on.' });
    if (environment && /sandbox|test/i.test(environment)) out.push({ id: 'payments', tab: 'settings', count: 1, tone: 'urgent', title: 'Payments are in test mode', detail: 'Card payments are not being collected for real.' });
    return out;
}

export async function adminOverview(env: CoaEnvironment, input: { orders: OverviewOrder[]; products: Product[]; shipping: ShippingOptionsConfig; environment: string | undefined; access: OverviewAccess; now?: number }): Promise<Overview> {
    const now = input.now ?? Date.now();
    const attention: Attention[] = [];
    if (input.access.orders) attention.push(...orderAttention(input.orders, input.products, now));
    if (input.access.requests) {
        const waiting = await overdueCustomers(env, now).catch(() => null);
        if (waiting === null) attention.push({ id: 'requests_error', tab: 'requests', count: 0, tone: 'normal', title: 'Customer requests could not be checked', detail: 'Open Customer requests to see who is waiting.' });
        else if (waiting.length) attention.push({ id: 'requests', tab: 'requests', count: waiting.length, tone: 'urgent', title: plural(waiting.length, 'customer') + ' waiting over a day for a reply',
            detail: waiting.slice(0, 3).map(w => `${w.name || w.email} (${ago(now, w.since)})`).join(', ') + (waiting.length > 3 ? ` and ${waiting.length - 3} more` : '') + '.' });
    }
    if (input.access.store) attention.push(...productAttention(input.products, input.orders.filter(o => orderBucket(o as any) === 'to_ship').map(o => ({ items: o.data?.items }))));
    // Urgent first, then the order work happens in.
    attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1));
    return { generatedAt: now, attention, sales: input.access.reports ? salesWindows(input.orders, now, input.environment) : null, setup: input.access.store ? setupAttention(input.shipping, input.environment) : [] };
}
