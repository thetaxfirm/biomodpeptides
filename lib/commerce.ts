import { products, Product } from './catalog';
import { all, one, setting, parse } from './runtime';
export type CartLine = {
    id: number;
    quantity: number;
    packId?: string;
    packSize?: number;
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
export const defaultConfig: StoreConfig = { packDiscounts: { '3': null, '5': null, '10': null }, shippingCents: null, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false };
export async function config() { return { ...defaultConfig, ...await setting<Partial<StoreConfig>>('store', {}) }; }
export async function catalog(): Promise<Product[]> { const rows = await all<{
    id: number;
    data: string;
}>('SELECT id,data FROM product_overrides'); const map = new Map(rows.map(r => [r.id, parse<Partial<Product>>(r.data, {})])); return products.map(p => { const product = { ...p, ...map.get(p.id) }; return { ...product, inStock: product.inStock && (product.stockQuantity == null || product.stockQuantity > 0) }; }); }
export function validateLines(value: unknown): CartLine[] { if (!Array.isArray(value) || value.length > 100)
    throw new Error('Your cart contains too many items.'); return value.map(l => { if (!l || typeof l !== 'object' || !Number.isInteger(l.id) || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100)
    throw new Error('Choose a quantity from 1 to 100.'); return { id: l.id, quantity: l.quantity, ...(typeof l.packId === 'string' && /^[a-zA-Z0-9-]{1,60}$/.test(l.packId) ? { packId: l.packId, packSize: Number(l.packSize) } : {}), ...(typeof l.presaleId === 'string' && /^[a-zA-Z0-9-]{1,60}$/.test(l.presaleId) ? { presaleId: l.presaleId } : {}) }; }); }
export async function quote(lines: CartLine[]) {
    const [ps, cfg] = await Promise.all([catalog(), config()]);
    const byId = new Map(ps.map(p => [p.id, p]));
    const packed = new Map<string, CartLine[]>();
    let subtotal = 0;
    let discount = 0;
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
        const target = ls[0].packSize;
        if (![3, 5, 10].includes(target!) || ls.some(l => l.packSize !== target || !byId.get(l.id)?.categories.some(c => c.slug === 'research-peptides')) || ls.reduce((s, l) => s + l.quantity, 0) !== target)
            throw new Error('Complete every slot in your research peptide pack.');
        const percent = cfg.packDiscounts[String(target)] ?? 0;
        discount += Math.round(ls.reduce((s, l) => s + byId.get(l.id)!.price * l.quantity, 0) * percent / 100);
    }
    return { subtotal, discount, total: subtotal - discount, currency: 'USD' as const, items: lines.map(l => ({ ...l, product: byId.get(l.id)! })), config: cfg };
}
