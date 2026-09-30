import type { Product } from './catalog';

export const packSizes = [1, 3, 5, 10] as const;
export const packDiscounts: Record<string, number | null> = { '1': 0, '3': 10, '5': 15, '10': 20 };
export const supportsPacks = (p: Product) => p.categories.some(c => ['research-compounds', 'softgels', 'spray-products'].includes(c.slug));
export const packUnit = (p: Product) => p.categories.some(c => ['softgels', 'spray-products'].includes(c.slug)) ? 'bottle' : 'vial';
export function fixedPackPrice(p: Product, count: number) {
    if (count === 1) return p.price;
    const configured = p.packPrices?.[String(count)];
    return Math.min(p.price * count, configured ?? p.price * count - Math.round(p.price * count * (packDiscounts[count] || 0) / 100));
}
export const packUnitLimit = (p: Product) => Math.min(p.maxQuantity ?? 100, p.stockQuantity ?? 100);

export const packContents = (p: Product) => { const contents = p.sizes[0] || ''; return packUnit(p) === 'bottle' && contents && !/bottle/i.test(contents) ? contents + ' / bottle' : contents; };
