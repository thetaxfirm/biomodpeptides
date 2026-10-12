import { products, type Product } from './catalog';

export const availabilityOptions = ['available', 'coming_soon', 'sold_out', 'unavailable'] as const;
export type ProductAvailability = typeof availabilityOptions[number];
const labels: Record<ProductAvailability, string> = { available: 'In stock', coming_soon: 'Coming soon', sold_out: 'Sold out', unavailable: 'Unavailable' };
// Source publication holds require their own documented release. Admin inventory
// or status edits cannot silently publish a held product.
const heldProducts = new Map(products.filter(p => !p.purchasable && p.availabilityLabel).map(p => [p.id, p.availabilityLabel!]));
export const hasPublicationHold = (p: Pick<Product, 'id'>) => heldProducts.has(p.id);
export function productAvailability(p: Product): ProductAvailability {
    if (hasPublicationHold(p)) return 'unavailable';
    if (p.availability && p.availability !== 'available' && availabilityOptions.includes(p.availability)) return p.availability;
    if (!p.purchasable) return 'unavailable';
    if (!p.inStock || (p.stockQuantity != null && p.stockQuantity <= 0)) return 'sold_out';
    return 'available';
}
export function productAvailabilityLabel(p: Product): string {
    return heldProducts.get(p.id) || labels[productAvailability(p)];
}
export function applyAvailability(p: Product): Product {
    const state = productAvailability(p);
    return { ...p, inStock: state === 'available' && p.inStock,
        purchasable: p.purchasable && !hasPublicationHold(p) && (!p.availability || p.availability === 'available'),
        availabilityLabel: productAvailabilityLabel(p) };
}
export function schemaAvailability(p: Product): string {
    // Coming soon has no order-taking promise and must never be described as PreOrder.
    return productAvailability(p) === 'available'
        ? p.activePreorder ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock';
}
