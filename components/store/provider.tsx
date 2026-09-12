'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { products as initialProducts, Product } from '@/lib/catalog';
import { packDiscounts, packSizes } from '@/lib/packs';
import type { CartLine, StoreConfig } from '@/lib/commerce';
import { toast, Toaster } from 'sonner';
const initialConfig: StoreConfig = { packDiscounts: { ...packDiscounts }, shippingCents: null, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false };
export async function api(action: string, body?: unknown) { const r = await fetch('/api/store/' + action, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const d = await r.json() as any; if (!r.ok)
    throw new Error(d.error || 'Please try again.'); return d; }
type Store = {
    products: Product[];
    config: StoreConfig;
    cart: CartLine[];
    wishlist: number[];
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
    campaigns: any[];
};
const defaults: Store = { products: initialProducts, config: initialConfig, cart: [], wishlist: [], customer: null, authReady: false, googleReady: false, admin: false, payment: { enabled: false, state: 'not_configured' }, totals: null, cartError: '', campaigns: [] };
const Context = createContext<{
    store: Store;
    ready: boolean;
    refresh: () => Promise<void>;
    saveCart: (cart: CartLine[]) => Promise<void>;
    add: (p: Product, quantity?: number, presaleId?: string) => Promise<void>;
    addFixedPack: (p: Product, count: number, packs?: number) => Promise<void>;
    addMixedPack: (ids: number[]) => Promise<void>;
    wish: (id: number) => Promise<void>;
} | null>(null);
export function StoreProvider({ children }: {
    children: ReactNode;
}) {
    const [store, setStore] = useState(defaults);
    const [ready, setReady] = useState(false);
    const stateRef = useRef(store);
    const queue = useRef<Promise<void>>(Promise.resolve());
    async function refresh() { const d = await api('state'); stateRef.current = d; setStore(d); setReady(true); }
    useEffect(() => { api('auth-refresh', {}).catch(() => null).then(refresh).catch(() => toast.error('Saved cart is temporarily unavailable. Please refresh to try again.')); }, []);
    async function saveCart(cart: CartLine[]) { await api('cart', { cart }); await refresh(); }
    async function add(p: Product, quantity = 1, presaleId?: string) { const operation = queue.current.catch(() => { }).then(async () => { const cart = [...stateRef.current.cart]; const at = cart.findIndex(l => l.id === p.id && !l.packId && l.presaleId === presaleId); if (at >= 0)
        cart[at] = { ...cart[at], quantity: cart[at].quantity + quantity };
    else
        cart.push({ id: p.id, quantity, ...(presaleId ? { presaleId } : {}) }); await saveCart(cart); toast.success(p.name + ' added to cart', { action: { label: 'View cart', onClick: () => location.assign('/cart') } }); }); queue.current = operation; return operation; }
    function enqueueCart(transform: (cart: CartLine[]) => CartLine[]) {
        const operation = queue.current.catch(() => {}).then(async () => { await saveCart(transform(stateRef.current.cart)); });
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
    return <Context.Provider value={{ store, ready, refresh, saveCart, add, addFixedPack, addMixedPack, wish }}>{children}<Toaster position="bottom-right" richColors/></Context.Provider>;
}
export const useStore = () => useContext(Context)!;
export const report = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Please try again.');
