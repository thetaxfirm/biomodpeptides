import type { Product } from './catalog';
// Owner rule, October 13, 2026: never mail out a product without an original COA for the lot being sold.
// The COA can travel with the delivery or be sent on request. A product clears as soon as its COA is attached.
export type NoCoaProduct = { id: number; name: string; lot: string | null; waitingOrders: number };
export const hasCoa = (product: Product | undefined) => product?.resolvedBatch?.coa_available === true;
/** Names of the order's products that cannot ship yet, judged against current COA records. */
export function coaBlockedItems(items: unknown, products: Product[]): string[] {
    const byId = new Map(products.map(p => [p.id, p]));
    const names = new Set<string>();
    for (const item of Array.isArray(items) ? items : []) {
        const id = Number((item as any)?.id ?? (item as any)?.product?.id);
        const product = byId.get(id);
        if (!hasCoa(product)) names.add(product?.name || (item as any)?.product?.name || 'Product ' + id);
    }
    return [...names];
}
export function noCoaProducts(products: Product[], waiting: { items: unknown }[] = []): NoCoaProduct[] {
    return products.filter(p => !hasCoa(p)).map(p => ({
        id: p.id, name: p.name, lot: p.resolvedBatch?.product_lot ?? null,
        waitingOrders: waiting.filter(o => (Array.isArray(o.items) ? o.items : []).some((i: any) => Number(i?.id ?? i?.product?.id) === p.id)).length,
    })).sort((a, b) => b.waitingOrders - a.waitingOrders || a.name.localeCompare(b.name));
}
export const coaBlockMessage = (names: string[]) => 'Do not ship yet: no COA on file for ' + names.join(', ') + '. Attach the COA under Products, then ship.';
