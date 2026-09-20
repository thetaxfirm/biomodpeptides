import { applySale } from './sales';
import { products, Product } from './catalog';
import { all, one, setting, parse } from './runtime';
import { packDiscounts, packSizes, fixedPackPrice, supportsPacks } from './packs';
export type CartLine = {
    id: number;
    quantity: number;
    packId?: string;
    packSize?: number;
    packKind?: 'fixed' | 'mixed';
    presaleId?: string;
};
export type StoreConfig = {
    packDiscounts: Record<string, number | null>;
    shippingCents: number | null;
    freeShippingAt: number;
    presalesEnabled: boolean;
    rewardsEnabled: boolean;
    affiliateEnabled: boolean;
};
export const defaultConfig: StoreConfig = { packDiscounts: { ...packDiscounts }, shippingCents: null, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false };
export async function config(): Promise<StoreConfig> { const stored = await setting<Partial<StoreConfig>>('store', {}); return { ...defaultConfig, ...stored, packDiscounts: { ...defaultConfig.packDiscounts, ...stored.packDiscounts, '1': 0 } }; }
export async function catalog(withSales = true): Promise<Product[]> { const rows = await all<{
    id: number;
    data: string;
}>('SELECT id,data FROM product_overrides'); const map = new Map(rows.map(r => [r.id, parse<Partial<Product>>(r.data, {})])); return products.map(p => { const override = map.get(p.id) || {}; const editable = ['price', 'packPrices', 'sale', 'inStock', 'purchasable', 'stockQuantity', 'maxQuantity'] as const; const product = { ...p, ...Object.fromEntries(editable.filter(key => override[key] !== undefined).map(key => [key, override[key]])) };  const available = { ...product, inStock: product.inStock && (product.stockQuantity == null || product.stockQuantity > 0) }; return withSales ? applySale(available) : available; }); }
export function validateLines(value: unknown): CartLine[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error('Your cart contains too many items.');
    return value.map(l => {
        if (!l || typeof l !== 'object' || !Number.isInteger(l.id) || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100) throw new Error('Choose a quantity from 1 to 100.');
        if (l.packId !== undefined && (typeof l.packId !== 'string' || !/^[a-zA-Z0-9-]{1,60}$/.test(l.packId) || !packSizes.includes(l.packSize))) throw new Error('Choose a valid pack.');
        if (l.packKind !== undefined && (!l.packId || !['fixed','mixed'].includes(l.packKind))) throw new Error('Choose a valid pack type.');
        return { id: l.id, quantity: l.quantity, ...(l.packId ? { packId: l.packId, packSize: l.packSize, packKind: l.packKind || 'mixed' } : {}), ...(typeof l.presaleId === 'string' && /^[a-zA-Z0-9-]{1,60}$/.test(l.presaleId) ? { presaleId: l.presaleId } : {}) };
    });
}
export async function quote(lines: CartLine[]) {
    const [ps, cfg] = await Promise.all([catalog(), config()]);
    const byId = new Map(ps.map(p => [p.id, p]));
    const packed = new Map<string, CartLine[]>();
    let subtotal = 0;
    let discount = 0;
    const lineDiscount = new Map<CartLine, number>();
    const totalById = new Map<number, number>();
    for (const l of lines) {
        const p = byId.get(l.id);
        if (!p || !p.purchasable || !p.inStock)
            throw new Error('An item in your cart is no longer available. Please update your cart.');
        totalById.set(l.id, (totalById.get(l.id) || 0) + l.quantity);
        subtotal += p.price * l.quantity;
        if (l.packId)
            packed.set(l.packId, [...(packed.get(l.packId) || []), l]);
    }
    for (const [id, n] of totalById) {
        const p = byId.get(id)!;
        if (n > (p.maxQuantity ?? 100) || (p.stockQuantity != null && n > p.stockQuantity))
            throw new Error(`${p.name}: quantity exceeds current availability.`);
    }
    const campaignIds = new Set(lines.map(l => l.presaleId || ''));
    if (campaignIds.size > 1)
        throw new Error('Presale and regular products must be ordered separately.');
    if (lines[0]?.presaleId) {
        const row = await one<{
            data: string;
            active: number;
        }>('SELECT data,active FROM campaigns WHERE id=?', lines[0].presaleId);
        const c = parse<Record<string, any>>(row?.data, {});
        if (!cfg.presalesEnabled || !row?.active || !Number.isFinite(Date.parse(c.starts)) || !Number.isFinite(Date.parse(c.ends)) || Date.now() < Date.parse(c.starts) || Date.now() > Date.parse(c.ends))
            throw new Error('This presale is not open.');
        if (lines.reduce((s, l) => s + l.quantity, 0) > (c.maxPerCustomer || 1))
            throw new Error('This presale exceeds the customer quantity limit.');
        if (lines.some(l => l.packId))
            throw new Error('Pack discounts are not available for presales.');
        if (lines.some(l => !(c.productIds || []).includes(l.id)))
            throw new Error('A product is not part of this presale.');
    }
    for (const ls of packed.values()) {
        const target = ls[0].packSize!;
        const kind = ls[0].packKind || 'mixed';
        if (!packSizes.includes(target as any) || ls.some(l => l.packSize !== target || (l.packKind || 'mixed') !== kind || !supportsPacks(byId.get(l.id)!)) || ls.reduce((s, l) => s + l.quantity, 0) !== target)
            throw new Error('Complete every slot in your pack.');
        if (kind === 'fixed' && ls.length !== 1) throw new Error('A fixed pack must contain one product.');
        const base = ls.reduce((s, l) => s + byId.get(l.id)!.price * l.quantity, 0);
        const savings = kind === 'fixed' ? base - fixedPackPrice(byId.get(ls[0].id)!, target) : Math.round(base * (cfg.packDiscounts[String(target)] ?? 0) / 100);
        discount += savings;
        let allocated = 0;
        ls.forEach((l, i) => {
            const amount = i === ls.length - 1 ? savings - allocated : Math.floor(savings * byId.get(l.id)!.price * l.quantity / base);
            lineDiscount.set(l, amount); allocated += amount;
        });
    }
    return { subtotal, discount, total: subtotal - discount, currency: 'USD' as const, items: lines.map(l => ({ ...l, product: byId.get(l.id)!, lineTotal: byId.get(l.id)!.price * l.quantity - (lineDiscount.get(l) || 0) })), config: cfg };
}
