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
export type OverviewOrderSummary = { toShip: { count: number; oldest: number; labels: number; coaBlocked: number }; review: number; backorder: { count: number; oldest: number }; sales: SalesWindow[]; coaProductIds: number[] };
export type OverviewAccess = { orders: boolean; requests: boolean; reports: boolean; store: boolean };

const ago = (now: number, since: number) => { const d = Math.floor((now - since) / DAY); return d < 1 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

export function orderAttention(orders: OverviewOrder[], products: Product[], now: number): Attention[] {
    const bucketed = orders.filter(o => !isArchived(o) && PAID.has(o.status)).map(o => ({ ...o, work: tabForOrder(o, now) }));
    const toShip = bucketed.filter(o => o.work === 'to_ship'), backorder = bucketed.filter(o => o.work === 'backorder');
    const blocked = !COA_REQUIRED_TO_SHIP ? [] : toShip.filter(o => (Array.isArray(o.data?.items) ? o.data.items : []).some((i: any) => !hasCoa(products.find(p => p.id === Number(i?.id ?? i?.product?.id)))));
    return summarizedOrderAttention({ toShip: { count: toShip.length, oldest: Math.min(...toShip.map(o => o.created)), labels: toShip.filter(o => Boolean(o.data?.shipment)).length, coaBlocked: blocked.length }, review: bucketed.filter(o => o.work === 'review').length, backorder: { count: backorder.length, oldest: Math.min(...backorder.map(o => o.created)) } }, now);
}

export function summarizedOrderAttention(summary: Pick<OverviewOrderSummary, 'toShip' | 'review' | 'backorder'>, now: number): Attention[] {
    const out: Attention[] = [], { toShip, review, backorder } = summary;
    if (toShip.count) out.push({ id: 'to_ship', tab: 'orders', count: toShip.count, tone: now - toShip.oldest > 2 * DAY ? 'urgent' : 'normal', title: plural(toShip.count, 'order') + ' to pack & ship',
        detail: `Oldest waiting ${ago(now, toShip.oldest)}. ${toShip.labels} with a label ready; no handoff recorded.` + (toShip.coaBlocked ? ` ${toShip.coaBlocked} can't ship until a COA is attached.` : '') });
    if (review) out.push({ id: 'review', tab: 'orders', count: review, tone: 'urgent', title: (review === 1 ? '1 order needs' : review + ' orders need') + ' attention', detail: 'Check the reason on each order: a payment that did not verify, an order hold, label approval or a delivery issue.' });
    if (backorder.count) out.push({ id: 'backorder', tab: 'orders', count: backorder.count, tone: now - backorder.oldest > 14 * DAY ? 'urgent' : 'normal', title: plural(backorder.count, 'order') + ' waiting on stock',
        detail: `Oldest waiting ${ago(now, backorder.oldest)}. Held for an item not in stock, or carrying a preorder line. None can be packed until the batch arrives.` });
    return out;
}

export function productAttention(products: Product[], waitingOrders: { items: unknown }[], coaProductIds?: number[]): Attention[] {
    const out: Attention[] = [];
    const selling = products.filter(p => productAvailability(p) === 'available');
    const blocked = (COA_REQUIRED_TO_SHIP ? noCoaProducts(selling, waitingOrders) : []).filter(p => p.waitingOrders > 0);
    if (blocked.length) out.push({ id: 'coa_blocked', tab: 'products', count: blocked.length, tone: 'urgent', title: plural(blocked.length, 'product') + ' holding up paid orders: no COA', detail: blocked.slice(0, 4).map(p => p.name).join(', ') + (blocked.length > 4 ? ` and ${blocked.length - 4} more` : '') + '. Attach the COA to release them.' });
    // catalog() already sets inStock=false for zero stock. Evaluate that normalized state
    // before filtering to sellable products; publication holds and coming-soon remain excluded.
    const out0 = products.filter(p => productAvailability(p) === 'sold_out');
    if (out0.length) out.push({ id: 'out_of_stock', tab: 'products', count: out0.length, tone: 'urgent', title: plural(out0.length, 'product') + ' out of stock', detail: out0.slice(0, 4).map(p => p.name).join(', ') + '.' });
    const low = selling.filter(p => p.stockQuantity != null && p.stockQuantity > 0 && p.stockQuantity <= 5);
    if (low.length) out.push({ id: 'low_stock', tab: 'products', count: low.length, tone: 'normal', title: plural(low.length, 'product') + ' low on stock (5 or fewer)', detail: low.slice(0, 4).map(p => `${p.name} (${p.stockQuantity})`).join(', ') + '.' });
    const noCoa = selling.filter(p => !hasCoa(p)).length;
    if (noCoa) out.push({ id: 'no_coa', tab: 'products', count: noCoa, tone: 'normal', title: plural(noCoa, 'product') + ' for sale without a COA', detail: COA_REQUIRED_TO_SHIP ? "Attach the original COA for the current lot before shipping." : "The current lot has no attached COA. Shipping follows the current fulfillment policy." });
    return out;
}

export function salesWindows(orders: OverviewOrder[], now: number): SalesWindow[] {
    // Match Sales diagnostics: fulfillment holds do not undo a recorded payment.
    // The saved environment is authoritative; today's configured provider cannot reclassify history.
    const paid = orders.filter(o => PAID.has(o.status) && !o.data?.internalTest && Number.isSafeInteger(o.created) && o.created <= now);
    const empty = (): SalesCohort => ({ orders: 0, paymentRecorded: 0, grossCents: 0, missingPaymentRecords: 0 });
    const since = (label: string, from: number, end = now + 1): SalesWindow => {
        const window: SalesWindow = { label, orders: 0, revenue: 0, live: empty(), sandbox: empty(), unknown: empty() };
        for (const order of paid) {
            if (order.created < from || order.created >= end) continue;
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
    const midnight = Math.floor(now / DAY) * DAY;
    return [since('Today (UTC, partial)', midnight), since('Last 7 complete days (UTC)', midnight - 7 * DAY, midnight), since('Last 30 complete days (UTC)', midnight - 30 * DAY, midnight)];
}

export function setupAttention(shipping: ShippingOptionsConfig, environment: string | undefined): Attention[] {
    const out: Attention[] = [];
    if (!shipping.services) out.push({ id: 'shipping', tab: 'settings', count: 1, tone: 'urgent', title: 'Shipping prices are not set up', detail: 'Checkout charges the bare carrier rate with nothing added. Choose services and your extra charge in Settings.' });
    else if (!shipping.services.some(s => s.enabled)) out.push({ id: 'shipping_off', tab: 'settings', count: 1, tone: 'urgent', title: 'Every shipping service is turned off', detail: 'Customers cannot check out until at least one service is on.' });
    if (environment && /sandbox|test/i.test(environment)) out.push({ id: 'payments', tab: 'settings', count: 1, tone: 'urgent', title: 'Payments are in test mode', detail: 'Card payments are not being collected for real.' });
    return out;
}

export async function adminOverview(env: CoaEnvironment, input: { orders: OverviewOrder[]; orderSummary?: OverviewOrderSummary; products: Product[]; shipping: ShippingOptionsConfig; environment: string | undefined; access: OverviewAccess; now?: number }): Promise<Overview> {
    const now = input.now ?? Date.now();
    const attention: Attention[] = [];
    if (input.access.orders) attention.push(...(input.orderSummary ? summarizedOrderAttention(input.orderSummary, now) : orderAttention(input.orders, input.products, now)));
    if (input.access.requests) {
        const waiting = await overdueCustomers(env, now).catch(() => null);
        if (waiting === null) attention.push({ id: 'requests_error', tab: 'requests', count: 0, tone: 'normal', title: 'Customer requests could not be checked', detail: 'Open Customer requests to see who is waiting.' });
        else if (waiting.length) attention.push({ id: 'requests', tab: 'requests', count: waiting.length, tone: 'urgent', title: plural(waiting.length, 'customer') + ' waiting over a day for a reply',
            detail: waiting.slice(0, 3).map(w => `${w.name || w.email} (${ago(now, w.since)})`).join(', ') + (waiting.length > 3 ? ` and ${waiting.length - 3} more` : '') + '.' });
    }
    if (input.access.store) attention.push(...productAttention(input.products, input.orders.filter(o => !isArchived(o) && tabForOrder(o, now) === 'to_ship').map(o => ({ items: o.data?.items })), input.orderSummary?.coaProductIds));
    // Urgent first, then the order work happens in.
    attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1));
    return { generatedAt: now, attention, sales: input.access.reports ? (input.orderSummary?.sales || salesWindows(input.orders, now)) : null, setup: input.access.store ? setupAttention(input.shipping, input.environment) : [] };
}
