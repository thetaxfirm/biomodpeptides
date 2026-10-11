'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { products as initialProducts, Product } from '@/lib/catalog';
import { packDiscounts, packSizes } from '@/lib/packs';
import type { CartLine, StoreConfig } from '@/lib/commerce';
import type { CartConflict } from '@/lib/cart-import';
import { toast, Toaster } from 'sonner';
import { measureShoppingStage, watchShoppingView, validShoppingQuote, validShoppingHandoff, type MeasureShopping } from '@/lib/shopping-measurement';
import type { ShoppingStage } from '@/lib/shopping-metrics';
const initialConfig: StoreConfig = { packDiscounts: { ...packDiscounts }, shippingCents: null, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false };
export async function api(action: string, body?: unknown) { const r = await fetch('/api/store/' + action, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const d = await r.json() as any; if (!r.ok)
    throw new Error(d.error || 'Please try again.'); return d; }
type Store = {
    products: Product[];
    config: StoreConfig;
    cart: CartLine[];
    cartConflict: CartConflict | null;
    wishlist: number[];
    savedPacks: {id:string;name:string;products:number[];updated:number}[];
    customer: {
        id: string;
        email: string;
        name: string;
    } | null;
    authReady: boolean;
    googleReady: boolean;
    admin: boolean;
    payment: {
        enabled: boolean;
        state: string;
    };
    totals: any;
    cartError: string;
    cartNotice?: string;
    campaigns: any[];
};
const defaults: Store = { products: initialProducts, config: initialConfig, cart: [], cartConflict: null, wishlist: [], savedPacks: [], customer: null, authReady: false, googleReady: false, admin: false, payment: { enabled: false, state: 'not_configured' }, totals: null, cartError: '', campaigns: [] };
const Context = createContext<{
    store: Store;
    ready: boolean;
    loadError: string;
    measureShopping: MeasureShopping;
    observeShoppingView: (stage: ShoppingStage) => () => void;
    validShoppingQuote: typeof validShoppingQuote;
    validShoppingHandoff: typeof validShoppingHandoff;
    refresh: () => Promise<void>;
    saveCart: (cart: CartLine[]) => Promise<void>;
    add: (p: Product, quantity?: number, presaleId?: string) => Promise<void>;
    addFixedPack: (p: Product, count: number, packs?: number) => Promise<void>;
    addMixedPack: (ids: number[]) => Promise<void>;
    reorder: (items: CartLine[]) => Promise<void>;
    wish: (id: number) => Promise<void>;
} | null>(null);
export function StoreProvider({ children, initialCatalog = initialProducts, shoppingMeasurementEnabled = false }: {
    children: ReactNode; initialCatalog?: Product[]; shoppingMeasurementEnabled?: boolean;
}) {
    const [store, setStore] = useState({ ...defaults, products: initialCatalog });
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState('');
    const stateRef = useRef(store);
    const measurementStatus = useRef({ ready, loadError });
    measurementStatus.current = { ready, loadError };
    const measureShopping: MeasureShopping = (stage, options) => measureShoppingStage(shoppingMeasurementEnabled, { ...measurementStatus.current, store: stateRef.current }, stage, options);
    const observeShoppingView = (stage: ShoppingStage) => watchShoppingView(stage, measureShopping);
    const queue = useRef<Promise<void>>(Promise.resolve());
    async function refresh() { try { const d = await api('state'); stateRef.current = d; measurementStatus.current = { ready: true, loadError: '' }; setStore(d); setReady(true); setLoadError(''); } catch (e) { measurementStatus.current = { ready: measurementStatus.current.ready, loadError: 'Account and cart access could not load. Please retry.' }; setLoadError('Account and cart access could not load. Please retry.'); throw e; } }
    useEffect(() => { api('auth-refresh', {}).catch(() => null).then(refresh).catch(() => toast.error('Saved cart is temporarily unavailable. Please refresh to try again.')); }, []);
    useEffect(() => {
        const boundaries = store.products.flatMap(p => p.sale?.enabled ? [Date.parse(p.sale.starts), Date.parse(p.sale.ends)] : []).filter(t => t > Date.now());
        if (!boundaries.length) return;
        const timer = setTimeout(() => { refresh().catch(report); }, Math.min(2147483647, Math.max(100, Math.min(...boundaries) - Date.now() + 100)));
        return () => clearTimeout(timer);
    }, [store.products]);
    useEffect(() => { const update = () => { if (document.visibilityState === 'visible') refresh().catch(report); }; document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
    async function writeCart(cart: CartLine[], addition: boolean) {
        if (stateRef.current.cartConflict) throw new Error('Choose which cart to use in Your Cart before adding or changing items.');
        const owner = stateRef.current.customer?.id;
        const previousQuantity = stateRef.current.cart.reduce((sum, line) => sum + line.quantity, 0);
        const result = await api('cart', { cart });
        // Count one accepted addition, even if the following read fails. Quantity
        // edits/removals and delegated single-item pack calls do not count twice.
        if (addition && owner === stateRef.current.customer?.id && Array.isArray(result.cart)
            && result.cart.reduce((sum: number, line: CartLine) => sum + line.quantity, 0) > previousQuantity)
            measureShopping('cart_add_confirmed', { cart: result.cart });
        await refresh();
    }
    async function saveCart(cart: CartLine[]) { await writeCart(cart, false); }
    async function add(p: Product, quantity = 1, presaleId?: string) { const operation = queue.current.catch(() => { }).then(async () => { const cart = [...stateRef.current.cart]; const at = cart.findIndex(l => l.id === p.id && !l.packId && l.presaleId === presaleId); if (at >= 0)
        cart[at] = { ...cart[at], quantity: cart[at].quantity + quantity };
    else
        cart.push({ id: p.id, quantity, ...(presaleId ? { presaleId } : {}) }); await writeCart(cart, true); toast.success(p.name + ' added to cart', { action: { label: 'View cart', onClick: () => location.assign('/cart') } }); }); queue.current = operation; return operation; }
    function enqueueCart(transform: (cart: CartLine[]) => CartLine[]) {
        const operation = queue.current.catch(() => {}).then(async () => { await writeCart(transform(stateRef.current.cart), true); });
        queue.current = operation;
        return operation;
    }
    async function addFixedPack(p: Product, count: number, packs = 1) {
        if (!packSizes.includes(count as any) || !Number.isInteger(packs) || packs < 1 || count * packs > 100) throw new Error('Choose an available pack quantity.');
        if (count === 1) return add(p, packs);
        await enqueueCart(cart => [...cart, ...Array.from({ length: packs }, () => ({ id: p.id, quantity: count, packId: crypto.randomUUID(), packSize: count, packKind: 'fixed' as const }))]);
        toast.success(p.name + ' ' + count + '-pack added to cart', { action: { label: 'View cart', onClick: () => location.assign('/cart') } });
    }
    async function addMixedPack(ids: number[]) {
        if (!packSizes.includes(ids.length as any)) throw new Error('Complete every slot in your pack.');
        if (ids.length === 1) { const p = stateRef.current.products.find(p => p.id === ids[0]); if (!p) throw new Error('Product unavailable.'); return add(p); }
        const packId = crypto.randomUUID();
        await enqueueCart(cart => [...cart, ...ids.map(id => ({ id, quantity: 1, packId, packSize: ids.length, packKind: 'mixed' as const }))]);
        toast.success('Your ' + ids.length + '-pack has been added to cart', { action: { label: 'View cart', onClick: () => location.assign('/cart') } });
    }
    async function wish(id: number) { const ids = store.wishlist.includes(id) ? store.wishlist.filter(i => i !== id) : [...store.wishlist, id]; await api('wishlist', { ids }); await refresh(); toast.success(ids.includes(id) ? 'Added to your wishlist' : 'Removed from your wishlist'); }
    async function reorder(items:CartLine[]){const groups=new Map<string,string>();const lines=items.map(l=>{if(!stateRef.current.products.some(p=>p.id===l.id))throw new Error('This order contains an unavailable product.');if(l.presaleId)throw new Error('Presale orders cannot be reordered. Choose currently released products from the shop.');if(l.packId&&!groups.has(l.packId))groups.set(l.packId,crypto.randomUUID());return {id:l.id,quantity:l.quantity,...(l.packId?{packId:groups.get(l.packId),packSize:l.packSize,packKind:l.packKind||'mixed' as const}:{})};});await enqueueCart(cart=>[...cart,...lines]);toast.success('Order added at current prices. Review your cart before checkout.');}
    return <Context.Provider value={{ store, ready, loadError, measureShopping, observeShoppingView, validShoppingQuote, validShoppingHandoff, refresh, saveCart, add, addFixedPack, addMixedPack, reorder, wish }}>{children}<Toaster position="bottom-right" richColors/></Context.Provider>;
}
export const useStore = () => useContext(Context)!;
export const report = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Please try again.');
