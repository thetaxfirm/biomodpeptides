// "Today" home for administration: what needs doing now, how sales are going, and store setup gaps.
// Work uses fulfillment buckets; sales use saved payment status and evidence, independently of shipping.
// Product attention consumes the normalized catalog, including its publication holds.
import type { Product } from './catalog';
import { hasCoa, noCoaProducts, COA_REQUIRED_TO_SHIP } from './coa-shipping';
import { productAvailability } from './availability';
import { tabForOrder, isArchived } from './order-queue';
import { overdueCustomers } from './reply-overdue';
import type { CoaEnvironment } from './coa-outbox';
import type { ShippingOptionsConfig } from './shipping-options';

const DAY = 86400000;
const PAID = new Set(['paid', 'labeling', 'shipped', 'delivered']);
export type OverviewOrder = { id: string; status: string; total: number; created: number; data: Record<string, any>; payment_ref?: string | null; notification_id?: string | null };
export type Attention = { id: string; tab: string; count: number; title: string; detail: string; tone: 'urgent' | 'normal' };
export type SalesCohort = { orders: number; paymentRecorded: number; grossCents: number; missingPaymentRecords: number };
// Retain the original fields for already-open admin bundles during deployment.
export type SalesWindow = { label: string; orders: number; revenue: number; live: SalesCohort; sandbox: SalesCohort; unknown: SalesCohort };
export type Overview = { generatedAt: number; attention: Attention[]; sales: SalesWindow[] | null; setup: Attention[] };
export type OverviewAccess = { orders: boolean; requests: boolean; reports: boolean; store: boolean };

const pacificMidnight = (now: number) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    // 08:00 UTC is midnight or 1 am Pacific, before the 2 am DST transition.
    const probe = Date.parse(day + 'T08:00:00Z');
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(probe)) % 24;
    return probe - hour * 3600000;
};
const ago = (now: number, since: number) => { const d = Math.floor((now - since) / DAY); return d < 1 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

export function orderAttention(orders: OverviewOrder[], products: Product[], now: number): Attention[] {
    const out: Attention[] = [];
    const bucketed = orders.filter(o => !isArchived(o)).map(o => ({ ...o, work: tabForOrder(o, now) }));
    const toShip = bucketed.filter(o => o.work === 'to_ship');
    if (toShip.length) {
        const blocked = !COA_REQUIRED_TO_SHIP ? [] : toShip.filter(o => (Array.isArray(o.data?.items) ? o.data.items : []).some((i: any) => !hasCoa(products.find(p => p.id === Number(i?.id ?? i?.product?.id)))));
        const oldest = Math.min(...toShip.map(o => o.created));
        const labels = toShip.filter(o => Boolean(o.data?.shipment)).length;
        out.push({ id: 'to_ship', tab: 'orders', count: toShip.length, tone: now - oldest > 2 * DAY ? 'urgent' : 'normal', title: plural(toShip.length, 'order') + ' to pack & ship',
            detail: `Oldest waiting ${ago(now, oldest)}. ${labels} with a label ready; no handoff recorded.` + (blocked.length ? ` ${blocked.length} can't ship until a COA is attached.` : '') });
    }
    const review = bucketed.filter(o => o.work === 'review');
    if (review.length) out.push({ id: 'review', tab: 'orders', count: review.length, tone: 'urgent', title: (review.length === 1 ? '1 order needs' : review.length + ' orders need') + ' attention', detail: 'Check the reason on each order: payment, order hold, label approval or delivery issue.' });
    const unpaid = bucketed.filter(o => o.work === 'unpaid');
    if (unpaid.length) out.push({ id: 'unpaid', tab: 'orders', count: unpaid.length, tone: 'normal', title: plural(unpaid.length, 'checkout') + ' with payment to confirm', detail: 'Check payment and customer history before preparing a follow-up. An unfinished checkout is not proof of a failed purchase.' });
    return out;
}

export function productAttention(products: Product[], waitingOrders: { items: unknown }[]): Attention[] {
    const out: Attention[] = [];
    const selling = products.filter(p => productAvailability(p) === 'available');
    const blocked = noCoaProducts(selling, waitingOrders).filter(p => p.waitingOrders > 0);
    if (blocked.length) out.push({ id: 'coa_blocked', tab: 'products', count: blocked.length, tone: 'urgent', title: plural(blocked.length, 'product') + ' holding up paid orders: no COA', detail: blocked.slice(0, 4).map(p => p.name).join(', ') + (blocked.length > 4 ? ` and ${blocked.length - 4} more` : '') + '. Attach the COA to release them.' });
    // catalog() already sets inStock=false for zero stock. Evaluate that normalized state
    // before filtering to sellable products; publication holds and coming-soon remain excluded.
    const out0 = products.filter(p => productAvailability(p) === 'sold_out');
    if (out0.length) out.push({ id: 'out_of_stock', tab: 'products', count: out0.length, tone: 'urgent', title: plural(out0.length, 'product') + ' out of stock', detail: out0.slice(0, 4).map(p => p.name).join(', ') + '.' });
    const low = selling.filter(p => p.stockQuantity != null && p.stockQuantity > 0 && p.stockQuantity <= 5);
    if (low.length) out.push({ id: 'low_stock', tab: 'products', count: low.length, tone: 'normal', title: plural(low.length, 'product') + ' low on stock (5 or fewer)', detail: low.slice(0, 4).map(p => `${p.name} (${p.stockQuantity})`).join(', ') + '.' });
    const noCoa = noCoaProducts(selling).length;
    if (noCoa) out.push({ id: 'no_coa', tab: 'products', count: noCoa, tone: 'normal', title: plural(noCoa, 'product') + ' for sale without a COA', detail: "Customers can order these, but they can't ship until the COA for the current lot is attached." });
    return out;
}

export function salesWindows(orders: OverviewOrder[], now: number): SalesWindow[] {
    // Match Sales diagnostics: fulfillment holds do not undo a recorded payment.
    // The saved environment is authoritative; today's configured provider cannot reclassify history.
    const paid = orders.filter(o => PAID.has(o.status) && !o.data?.internalTest && Number.isSafeInteger(o.created) && o.created <= now);
    const empty = (): SalesCohort => ({ orders: 0, paymentRecorded: 0, grossCents: 0, missingPaymentRecords: 0 });
    const since = (label: string, from: number): SalesWindow => {
        const window: SalesWindow = { label, orders: 0, revenue: 0, live: empty(), sandbox: empty(), unknown: empty() };
        for (const order of paid) {
            if (order.created < from) continue;
            const environment = order.data?.environment;
            const cohort = window[environment === 'live' || environment === 'authorizenet:live' ? 'live'
                : environment === 'sandbox' || environment === 'authorizenet:sandbox' ? 'sandbox' : 'unknown'];
            cohort.orders++;
            if (typeof order.payment_ref !== 'string' || !order.payment_ref.trim() || typeof order.notification_id !== 'string' || !order.notification_id.trim()) {
                cohort.missingPaymentRecords++;
                continue;
            }
            cohort.paymentRecorded++;
            if (Number.isSafeInteger(order.total) && order.total >= 0) cohort.grossCents += order.total;
        }
        window.orders = window.live.paymentRecorded;
        window.revenue = window.live.grossCents;
        return window;
    };
    return [since('Today', pacificMidnight(now)), since('Last 7 days', now - 7 * DAY), since('Last 30 days', now - 30 * DAY)];
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
    if (input.access.store) attention.push(...productAttention(input.products, input.orders.filter(o => !isArchived(o) && tabForOrder(o, now) === 'to_ship').map(o => ({ items: o.data?.items }))));
    // Urgent first, then the order work happens in.
    attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1));
    return { generatedAt: now, attention, sales: input.access.reports ? salesWindows(input.orders, now) : null, setup: input.access.store ? setupAttention(input.shipping, input.environment) : [] };
}
