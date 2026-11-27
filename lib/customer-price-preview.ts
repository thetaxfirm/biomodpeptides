import { quote, validateLines } from './commerce';
import { promoOwners } from './promo-ownership';
import { builtInCodes } from './promo-codes';

/** A projection of the actual checkout quote, never a second pricing implementation. */
export async function customerPricePreview(db: D1Database, raw: unknown, promoCode?: unknown) {
    const lines = validateLines(raw);
    if (!lines.length) throw new Error('Choose at least one product.');
    const result = await quote(lines, promoCode);
    const owner = result.promo ? (await promoOwners(db))[result.promo.code] : null;
    return {
        items: result.items.map(item => {
            const offer = item.product.activePreorder || item.product.activeSale;
            return { id: item.id, name: item.product.name, quantity: item.quantity, baseUnit: offer?.basePrice ?? item.product.price, currentUnit: item.product.price,
                offer: item.product.activePreorder ? 'Preorder' : item.product.activeSale ? 'Sale' : 'Base price',
                packKind: item.packKind || null, packDiscount: item.product.price * item.quantity - item.lineTotal - item.linePromoDiscount,
                promoDiscount: item.linePromoDiscount, total: item.lineTotal };
        }),
        subtotal: result.subtotal, packDiscount: result.packDiscount, promoDiscount: result.promoDiscount, total: result.total, promo: result.promo,
        attribution: result.promo ? { kind: owner?.kind || (builtInCodes().includes(result.promo.code) ? 'built-in' : 'manual'), label: owner?.label || 'Store promotion',
            note: owner?.kind === 'affiliate' ? 'Affiliate-managed code. Commission requires a live, non-self order and an approved partner with accepted current terms; the order captures those terms when placed.' : 'Store discount. A code alone does not establish an affiliate commission.' } : null,
    };
}
export type CustomerPricePreview = Awaited<ReturnType<typeof customerPricePreview>>;
