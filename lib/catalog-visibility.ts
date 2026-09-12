import { products } from './catalog';
import type { CartLine } from './commerce';

const currentProducts = new Map(products.map(product => [product.id, product]));
export const currentProductId = (id: unknown): id is number => typeof id === 'number' && currentProducts.has(id);
export function currentSelection(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(currentProductId);
}
export function currentCart(lines: CartLine[]): CartLine[] {
  const unavailablePacks = new Set(lines.filter(line => !currentProductId(line.id) && line.packId).map(line => line.packId));
  return lines.filter(line => currentProductId(line.id) && (!line.packId || !unavailablePacks.has(line.packId)));
}
export function unavailableOrder(data: Record<string, any>) {
  return !Array.isArray(data.items) || data.items.length === 0 || data.items.some((item: any) => !currentProductId(item.id));
}
// Preserve the financial ledger. Only the browser-facing product presentation changes.
export function orderView(data: Record<string, any>) {
  const items = (Array.isArray(data.items) ? data.items : []).map((item: any) => {
    const product = currentProducts.get(item.id);
    return {
      id: item.id, quantity: item.quantity, lineTotal: item.lineTotal,
      ...(product ? { packId: item.packId, packSize: item.packSize, packKind: item.packKind, presaleId: item.presaleId } : {}),
      unavailable: !product,
      product: { id: item.id, name: product?.name || 'Archived product', price: item.product?.price },
    };
  });
  return { items, subtotal: data.subtotal, discount: data.discount, shipping: data.shipping, tax: data.tax, total: data.total, address: data.address, tracking: data.tracking, catalogUnavailable: unavailableOrder(data) };
}
