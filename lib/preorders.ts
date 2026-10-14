import type { Product } from './catalog';
// Owner-approved initial run, October 12, 2026. Exact existing products only.
// No automatic release date: staff must confirm readiness before disabling preorder.
export const initialRunIds = [4357, 852, 781, 780, 779, 778, 777, 776, 775, 774, 773, 772, 771, 770, 769, 768, 767, 782];
export const initialRunPreorder = { enabled: true, percentOff: 15, ships: 'early November 2026' };
// Owner rule, October 14, 2026: preorders are purchased in their own order, never mixed with in-stock items.
export const preorderOrderNotice = 'Preorders are charged at checkout and purchased in their own order, separate from in-stock items. The order ships when the preorder is ready.';
export const preorderSeparateMessage = 'Preorders check out separately. Check out your in-stock items first, then place a separate order for preorders (or the other way around).';
/** True when the lines mix preorder and in-stock products (judged against current products). */
export function mixesPreorder(lines: { id: number }[], products: Pick<Product, 'id' | 'activePreorder'>[]): boolean {
    const byId = new Map(products.map(p => [p.id, p]));
    let pre = false, ready = false;
    for (const line of lines) { const p = byId.get(line.id); if (!p) continue; if (p.activePreorder) pre = true; else ready = true; }
    return pre && ready;
}
export function hasPreorder(items: { product?: Pick<Product, 'activePreorder'> }[] = []) {
    return items.some(item => Boolean(item.product?.activePreorder));
}
