import type { Product } from './catalog';
// Owner-approved initial run, October 12, 2026. Exact existing products only.
// No automatic release date: staff must confirm readiness before disabling preorder.
export const initialRunIds = [4357, 852, 781, 780, 779, 778, 777, 776, 775, 774, 773, 772, 771, 770, 769, 768, 767, 782];
export const initialRunPreorder = { enabled: true, percentOff: 15, ships: 'early November 2026' };
export const preorderOrderNotice = 'Preorders are charged at checkout. Orders containing preorder items ship together when all items are ready. Place a separate order for items you need sooner.';
export function hasPreorder(items: { product?: Pick<Product, 'activePreorder'> }[] = []) {
    return items.some(item => Boolean(item.product?.activePreorder));
}
