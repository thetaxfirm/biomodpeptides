'use client';
import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { products as initialProducts, Product } from '@/lib/catalog';
import { packDiscounts, packSizes } from '@/lib/packs';
import { applySale } from '@/lib/sales';
import { nextSaleBoundary } from '@/lib/sale-display';
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
    pricingStale?: boolean;
    cartError: string;
    cartNotice?: string;
    campaigns: any[];
};
const defaults: Store = { products: initialProducts, config: initialConfig, cart: [], cartConflict: null, wishlist: [], savedPacks: [], customer: null, authReady: false, googleReady: false, admin: false, payment: { enabled: false, state: 'not_configured' }, totals: null, pricingStale: false, cartError: '', campaigns: [] };
const Context = createContext<{
    store: Store;
    ready: boolean;
    loadError: string;
    cartSync: 'current' | 'saved' | 'uncertain';
    cartUpdating: boolean;
    measureShopping: MeasureShopping;
    observeShoppingView: (stage: ShoppingStage) => () => void;
    validShoppingQuote: typeof validShoppingQuote;
    validShoppingHandoff: typeof validShoppingHandoff;
    refresh: () => Promise<void>;
    saveCart: (cart: CartLine[], expectedCart?: CartLine[]) => Promise<void>;
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
    const [cartSync, setCartSync] = useState<'current' | 'saved' | 'uncertain'>('current');
    const [cartUpdating, setCartUpdating] = useState(false);
    const syncRef = useRef(cartSync);
    const mounted = useRef(false);
    const lifetime = useRef(0);
    const ownerVersion = useRef(0);
    const readVersion = useRef(0);
    const acceptedReadVersion = useRef(0);
    const writeVersion = useRef(0);
    const queuedWrites = useRef(0);
    function sync(next: typeof cartSync) { syncRef.current = next; setCartSync(next); }
    const stateRef = useRef(store);
    const measurementStatus = useRef({ ready, loadError });
    measurementStatus.current = { ready, loadError };
    const measureShopping: MeasureShopping = (stage, options) => {
        if (syncRef.current === 'uncertain' || (queuedWrites.current > 0 && stage !== 'cart_add_confirmed')) return;
        measureShoppingStage(shoppingMeasurementEnabled, { ...measurementStatus.current, store: stateRef.current }, stage, options);
    };
    const observeShoppingView = (stage: ShoppingStage) => watchShoppingView(stage, measureShopping);
    const queue = useRef<Promise<void>>(Promise.resolve());
    function repriceLocalProducts() {
        if (!mounted.current) return;
        const current = stateRef.current;
        const products = current.products.map(p => applySale(p));
        const cartIds = new Set(current.cart.map(line => line.id));
        const offer = (p: Product) => JSON.stringify([p.price, p.packPrices ?? null, p.activeSale ?? null, p.activePreorder ?? null]);
        const changed = products.some((p, index) => cartIds.has(p.id) && offer(p) !== offer(current.products[index]));
        // A locally changed offer is not an authoritative cart quote. Retain
        // the saved cart, but do not display its previous financial totals.
        stateRef.current = { ...current, products, pricingStale: Boolean(current.pricingStale || changed), totals: changed ? null : current.totals };
        setStore(stateRef.current);
    }
    async function refresh() {
        const read = ++readVersion.current, write = writeVersion.current, life = lifetime.current;
        const current = () => mounted.current && life === lifetime.current && read === readVersion.current && write === writeVersion.current;
        try {
            const d: Store = { ...await api('state'), pricingStale: false };
            if (!current()) throw new Error('A newer cart or account update has started. Retry to load the current details.');
            acceptedReadVersion.current = read;
            if (!measurementStatus.current.ready || d.customer?.id !== stateRef.current.customer?.id) ownerVersion.current += 1;
            stateRef.current = d;
            measurementStatus.current = { ready: true, loadError: '' };
            setStore(d); setReady(true); setLoadError(''); sync('current');
        } catch (e) {
            if (!current()) throw new Error('A newer cart or account update has started. Retry to load the current details.');
            measurementStatus.current = { ready: measurementStatus.current.ready, loadError: 'Account and cart access could not load. Please retry.' };
            setLoadError(measurementStatus.current.loadError);
            throw e;
        }
    }
    useEffect(() => {
        mounted.current = true;
        const life = ++lifetime.current;
        repriceLocalProducts();
        api('auth-refresh', {}).catch(() => null).then(() => {
            if (mounted.current && life === lifetime.current) return refresh();
        }).catch(() => { if (mounted.current && life === lifetime.current) toast.error('Saved cart is temporarily unavailable. Please refresh to try again.'); });
        return () => { mounted.current = false; lifetime.current += 1; ownerVersion.current += 1; readVersion.current += 1; };
    }, []);
    useEffect(() => {
        const boundary = nextSaleBoundary(store.products, Date.now());
        if (boundary === null) return;
        const timer = setTimeout(() => {
            if (!mounted.current) return;
            // End or start the displayed offer immediately, even if a network read fails.
            // Checkout still obtains a fresh authoritative quote before payment.
            repriceLocalProducts();
            refresh().catch(report);
        }, Math.min(2147483647, Math.max(100, boundary - Date.now() + 100)));
        return () => clearTimeout(timer);
    }, [store.products]);
    useEffect(() => { const update = () => { if (document.visibilityState === 'visible') { repriceLocalProducts(); refresh().catch(report); } }; document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
    function cartScope() { return { owner: ownerVersion.current, life: lifetime.current }; }
    function currentCartScope(scope: ReturnType<typeof cartScope>) {
        return mounted.current && scope.owner === ownerVersion.current && scope.life === lifetime.current;
    }
    async function writeCart(cart: CartLine[], addition: boolean, scope: ReturnType<typeof cartScope>) {
        if (stateRef.current.cartConflict) throw new Error('Choose which cart to use in Your Cart before adding or changing items.');
        const previousQuantity = stateRef.current.cart.reduce((sum, line) => sum + line.quantity, 0);
        // Invalidate reads begun before the write, and again when it settles so a
        // read begun during the write cannot later replace the accepted result.
        writeVersion.current += 1;
        let result: { cart: CartLine[]; totals: Store['totals'] };
        try {
            result = await api('cart', { cart });
            if (!Array.isArray(result.cart) || !result.totals) throw new Error('Cart confirmation was incomplete.');
        } catch (e) {
            if (currentCartScope(scope)) { writeVersion.current += 1; sync('uncertain'); }
            throw new Error('We could not confirm this cart change. Review your saved cart before trying again. ' + (e instanceof Error ? e.message : ''));
        }
        if (!currentCartScope(scope)) throw new Error('Your account changed. Review your current cart before making another change.');
        writeVersion.current += 1;
        // The server sends these fields only after persistence. Do not discard
        // them, replace other account fields, or replay this accepted mutation.
        stateRef.current = { ...stateRef.current, cart: result.cart, totals: result.totals, pricingStale: false, cartError: '', cartNotice: undefined };
        setStore(stateRef.current);
        if (addition && result.cart.reduce((sum, line) => sum + line.quantity, 0) > previousQuantity)
            measureShopping('cart_add_confirmed', { cart: result.cart });
        const precedingRead = readVersion.current;
        try { await refresh(); }
        catch { if (currentCartScope(scope) && acceptedReadVersion.current <= precedingRead) sync('saved'); }
        if (!currentCartScope(scope)) throw new Error('Your account changed. Review your current cart before making another change.');
    }
    function enqueueCart(transform: (cart: CartLine[]) => CartLine[], addition = true) {
        const scope = cartScope();
        if (!measurementStatus.current.ready) return Promise.reject(new Error('Wait for your saved cart to load before changing it.'));
        queuedWrites.current += 1; setCartUpdating(true);
        const operation = queue.current.catch(() => {}).then(async () => {
            if (!currentCartScope(scope)) throw new Error('Your account changed. Review your current cart before making another change.');
            if (syncRef.current === 'uncertain') throw new Error('Review your saved cart and retry cart access before making another change.');
            await writeCart(transform(stateRef.current.cart), addition, scope);
        }).finally(() => {
            queuedWrites.current -= 1;
            if (mounted.current) setCartUpdating(queuedWrites.current > 0);
        });
        queue.current = operation;
        return operation;
    }
    async function saveCart(cart: CartLine[], expectedCart = stateRef.current.cart) {
        const base = JSON.stringify(expectedCart);
        const replacement = cart.map(line => ({ ...line }));
        await enqueueCart(current => {
            if (JSON.stringify(current) !== base) throw new Error('Your cart changed while this update was waiting. Review it and try your change again.');
            return replacement;
        }, false);
    }
    async function add(p: Product, quantity = 1, presaleId?: string) {
        await enqueueCart(current => {
            const cart = [...current];
            const at = cart.findIndex(l => l.id === p.id && !l.packId && l.presaleId === presaleId);
            if (at >= 0) cart[at] = { ...cart[at], quantity: cart[at].quantity + quantity };
            else cart.push({ id: p.id, quantity, ...(presaleId ? { presaleId } : {}) });
            return cart;
        });
        toast.success(p.name + ' added to cart', { action: { label: 'View cart', onClick: () => location.assign('/cart') } });
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
    return <Context.Provider value={{ store, ready, loadError, cartSync, cartUpdating, measureShopping, observeShoppingView, validShoppingQuote, validShoppingHandoff, refresh, saveCart, add, addFixedPack, addMixedPack, reorder, wish }}>{children}<Toaster position="bottom-right" richColors/></Context.Provider>;
}
export const useStore = () => useContext(Context)!;
export const report = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Please try again.');
