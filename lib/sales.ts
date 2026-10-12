import type { Product } from './catalog';
import { productAvailability } from './availability';
// A scheduled percentage applies to current single and fixed-pack prices.
// Legacy regularPrice is not a sale claim or a discount base.
export function applySale(product: Product, now = Date.now()): Product {
    const { activeSale, activePreorder, ...rest } = product;
    const previous = activePreorder || activeSale;
    const p: Product = previous ? { ...rest, price: previous.basePrice, packPrices: previous.basePackPrices } : rest;
    // Closed products retain the configured offer, but do not advertise a live deal.
    if (productAvailability(p) !== 'available') return p;
    const preorder = p.preorder;
    // The preorder offer replaces a scheduled sale, so the same 15% cannot compound.
    // Existing pack and promo savings still apply downstream.
    if (preorder?.enabled && Number.isFinite(preorder.percentOff) && preorder.percentOff > 0 && preorder.percentOff < 100 && preorder.ships?.trim()) {
        const discount = (price: number) => Math.max(1, Math.round(price * (100 - preorder.percentOff) / 100));
        return { ...p, price: discount(p.price),
            packPrices: p.packPrices && Object.fromEntries(Object.entries(p.packPrices).map(([n, price]) => [n, price == null ? null : discount(price)])),
            activePreorder: { percentOff: preorder.percentOff, ships: preorder.ships, basePrice: p.price, basePackPrices: p.packPrices } };
    }
    const s = p.sale;
    if (!s?.enabled || !Number.isFinite(s.percentOff) || s.percentOff <= 0 || s.percentOff >= 100 ||
        !Number.isFinite(Date.parse(s.starts)) || !Number.isFinite(Date.parse(s.ends)) ||
        now < Date.parse(s.starts) || now >= Date.parse(s.ends)) return p;
    const discount = (price: number) => Math.max(1, Math.round(price * (100 - s.percentOff) / 100));
    return { ...p, price: discount(p.price),
        packPrices: p.packPrices && Object.fromEntries(Object.entries(p.packPrices).map(([n, price]) => [n, price == null ? null : discount(price)])),
        activeSale: { percentOff: s.percentOff, ends: s.ends, basePrice: p.price, basePackPrices: p.packPrices } };
}
