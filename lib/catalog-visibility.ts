import { savedBatch } from './batch-snapshot';
import { savedShippingOption } from './shipping-options';
import { products } from './catalog';
import { savedPreorder } from './fulfillment';
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
      product: { id: item.id, name: product?.name || 'Archived product', price: item.product?.price, ...(savedBatch(item.product?.soldBatch) ? { soldBatch: savedBatch(item.product.soldBatch) } : {}), ...(savedPreorder(item.product?.activePreorder) ? { activePreorder: savedPreorder(item.product.activePreorder) } : {}) },
    };
  });
  return { ...(data.internalTest === true ? {internalTest:true} : {}), ...(data.recovery ? {recovery:{savings:data.recovery.savings,appliedAt:data.recovery.appliedAt}} : {}), items, subtotal: data.subtotal, discount: data.discount, shipping: data.shipping, shippingService: typeof data.shippingService === 'string' ? data.shippingService.slice(0,160) : undefined, ...(savedShippingOption(data.shippingOption) ? { shippingOption: savedShippingOption(data.shippingOption) } : {}), tax: data.tax, total: data.total, address: data.address, tracking: data.tracking, ...(data.shipment ? { shipment: { status: data.shipment.status, checkedAt: data.shipment.checkedAt } } : {}), catalogUnavailable: unavailableOrder(data) };
}
// Administrator copy: everything needed to pick, pack and ship the order, including the customer email, chosen service, promo and label.
export function adminOrderView(data: Record<string, any>) {
  return {
    ...orderView(data),
    email: data.email || '',
    packDiscount: data.packDiscount,
    promoDiscount: data.promoDiscount,
    promo: data.promo ? { code: data.promo.code, savings: data.promo.savings } : null,
    shippingService: data.shippingService,
    shipment: data.shipment,
    shippedAt: data.shippedAt,
    labelCreatedAt: data.labelCreatedAt,
    ...(data.hold ? { hold: data.hold } : {}),
    ...(Number.isFinite(data.archivedAt) ? { archivedAt: data.archivedAt, archivedBy: data.archivedBy } : {}),
    ...(typeof data.releasedReason === 'string' ? { releasedReason: data.releasedReason, releasedAt: data.releasedAt } : {}),
  };
}
