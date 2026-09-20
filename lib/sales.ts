import type { Product } from './catalog';
// A scheduled percentage applies to current single and fixed-pack prices.
// Legacy regularPrice is not a sale claim or a discount base.
export function applySale(product: Product, now = Date.now()): Product {
    const { activeSale, ...rest } = product;
    const p: Product = activeSale ? { ...rest, price: activeSale.basePrice, packPrices: activeSale.basePackPrices } : rest;
    const s = p.sale;
    if (!s?.enabled || !Number.isFinite(s.percentOff) || s.percentOff <= 0 || s.percentOff >= 100 ||
        !Number.isFinite(Date.parse(s.starts)) || !Number.isFinite(Date.parse(s.ends)) ||
        now < Date.parse(s.starts) || now >= Date.parse(s.ends)) return p;
    const discount = (price: number) => Math.max(1, Math.round(price * (100 - s.percentOff) / 100));
    return { ...p, price: discount(p.price),
        packPrices: p.packPrices && Object.fromEntries(Object.entries(p.packPrices).map(([n, price]) => [n, price == null ? null : discount(price)])),
        activeSale: { percentOff: s.percentOff, ends: s.ends, basePrice: p.price, basePackPrices: p.packPrices } };
}
