'use client';
import { AffiliateProgram } from './affiliate-program';
import { hasPreorder, preorderOrderNotice, mixesPreorder, preorderSeparateMessage } from '@/lib/preorders';
import { PreorderNotice } from './preorder-notice';
import { fulfillmentLabel, customerOrderStatus } from '@/lib/fulfillment';
import { ProductImage } from './product-image';
import { authLink, safeAuthReturn } from '@/lib/auth-return';
import { useEffect, useRef, useState, FormEvent } from 'react';
import { PromoCode } from './promo-code';
import type { ShippingOption } from '@/lib/shipping-options';
import { shippingTerms } from '@/lib/shipping-terms';
import { Eye, EyeOff, Trash2, Minus, Plus } from 'lucide-react';
import { useStore, api, report } from './provider';
import { money, compound } from '@/lib/catalog';
import { Field, Check, Blank, Choice, formData } from './primitives';
import { toast } from 'sonner';
import { ProductCard } from './catalog';
export const businessTypes: [string, string][] = [['university', 'University'], ['researcher', 'Researcher'], ['laboratory', 'Laboratory'], ['medical_professional', 'Medical professional'], ['other', 'Other research organization']];
export function AuthPage({ mode = 'login', returnTo = '/account' }: {
    mode?: string;
    returnTo?: string;
}) { const { store, ready, loadError, refresh } = useStore(); const destination = safeAuthReturn(returnTo); const adminDestination = /^\/admin(?:[?#]|$)/.test(destination); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const register = mode === 'register', recover = mode === 'forgot-password', reset = mode === 'reset-password'; const title = register ? 'Become a member' : recover ? (adminDestination ? 'Set your admin password' : 'Reset your password') : reset ? 'Choose a new password' : adminDestination ? 'Administrator sign in' : 'Sign in'; async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setMessage(''); try {
    const fields = formData(e.currentTarget);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const d = await api('auth-' + (register ? 'register' : recover ? 'recover' : reset ? 'reset' : 'login'), { ...fields, returnTo: destination, token: fragment.get('access_token') });
    if (d.returnTo)
        location.assign(d.returnTo);
    else
        setMessage(d.message);
}
catch (e) {
    report(e);
}
finally {
    setBusy(false);
} } if (!ready) return <div className="auth-page"><h1>{title}</h1><p role="status">{loadError || 'Loading secure account access…'}</p>{loadError && <button className="button button-dark" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); } catch (e) { report(e); } finally { setBusy(false); } }}>Retry account access</button>}</div>; if (!store.authReady) return <div className="auth-page"><h1>{adminDestination ? "Administrator sign-in is unavailable" : "Customer accounts are coming soon."}</h1><p>{adminDestination ? "Secure account access could not be connected. Please try again later." : "You can explore the collection and save products or packs with your shopping session."}</p><div className="checkout-unavailable-actions"><a className="button button-dark" href="/shop">Explore products</a><a href="/multi-pack">Your saved packs</a><a href="/contact">Contact Biomod</a></div></div>; return <div className="auth-page"><h1>{title}</h1>{adminDestination && <p>Sign in with your own approved administrator account to manage the shared TryBiomod store: orders, products, shipping and affiliate codes.</p>}{!store.authReady && <p className="notice">Customer sign-in is being connected. Account forms will become available when setup is complete.</p>}<form onSubmit={submit} className="store-form">{recover && adminDestination && <p className="muted">We will email you a secure link to choose your password. Access is limited to approved administrator addresses.</p>}{register && <><p className="muted">Membership is for research institutions and professionals. We will email you a link to verify your address before you can sign in.</p><Field label="Full name" name="name"/><Field label="Phone" name="phone" type="tel"/><Field label="Business name" name="company"/><Field label="Type of business" name="businessType"><select name="businessType" required defaultValue=""><option value="" disabled>Choose one</option>{businessTypes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field></>}{!reset && <Field label="Email address" name="email" type="email"/>}{!recover && <><label className="field"><span>Password {register && '(at least 8 characters)'}</span><div className="password-field"><input name="password" type={show ? 'text' : 'password'} required minLength={register || reset ? 8 : undefined} autoComplete={register || reset ? 'new-password' : 'current-password'}/><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div></label>{(register || reset) && <Field label="Confirm password" name="confirmPassword" type="password"/>}</>}<button className="button button-dark" disabled={busy || !store.authReady}>{busy ? 'Please wait…' : title}</button>{message && <p className="notice" role="status">{message}</p>}</form>{mode === 'login' ? <div className="auth-links">{store.googleReady && !adminDestination && <a className="button button-dark" href="/auth/google">Continue with Google</a>}<a href={authLink('forgot-password', destination)}>{adminDestination ? "Set or reset your admin password" : "Forgot password?"}</a>{!adminDestination && <p>New to Biomod? <a href={authLink('register', destination)}>Become a member</a></p>}</div> : <a href={authLink('login', destination)}>Back to sign in</a>}</div>; }

function CartChoice() {
    const { store, refresh } = useStore();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const conflict = store.cartConflict;
    if (!conflict) return null;
    async function choose(choice: string) {
        if (!conflict) return;
        setBusy(true); setError('');
        try { await api('cart-choice', { id: conflict.id, revision: conflict.revision, choice }); await refresh(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Please refresh and review your carts.'); await refresh().catch(() => null); }
        finally { setBusy(false); }
    }
    return <section className="content-page" aria-labelledby="cart-choice-title"><h1 id="cart-choice-title">Choose your cart</h1><p>{conflict.message}</p><p>We have kept both carts. Their contents will not be combined automatically.</p><div className="cart-choice-grid">{([['current', 'Current shopping cart', conflict.current], ['saved', 'Saved account cart', conflict.saved]] as const).map(([choice, title, lines]) => <div className="cart-choice-column" key={choice}><h2>{title}</h2>{lines.length ? <ul>{lines.map((line, i) => { const p = store.products.find(product => product.id === line.id); return <li key={i}>{p?.name || 'Unavailable product'}{p?.sizes[0] ? ' · ' + p.sizes[0] : ''} × {line.quantity}{line.packId ? ` · ${line.packSize}-pack (${line.packKind === 'fixed' ? 'same product' : 'mixed'})` : ''}</li>; })}</ul> : <p>No items.</p>}<button className="button button-dark cart-choice-action" disabled={busy} onClick={() => choose(choice)}>Use {choice === 'current' ? 'current shopping' : 'saved account'} cart</button></div>)}</div>{error && <p className="notice error" role="alert">{error}</p>}<p><button className="text-button" disabled={busy} onClick={() => choose('empty')}>Start an empty cart</button></p><a href="/shop">Continue browsing</a></section>;
}

// Retry reads the existing shopping session; it must never clear or resubmit a cart.
function useStoreLoadRetry(refresh: () => Promise<void>) {
    const [retrying, setRetrying] = useState(false);
    const inFlight = useRef(false);
    async function retryLoad() {
        if (inFlight.current) return;
        inFlight.current = true;
        setRetrying(true);
        try { await refresh(); }
        catch (e) { report(e); }
        finally { inFlight.current = false; setRetrying(false); }
    }
    return { retrying, retryLoad };
}
export function Cart() {
    const { store, ready, loadError, cartSync = 'current', cartUpdating = false, refresh, saveCart, observeShoppingView } = useStore();
    useEffect(() => observeShoppingView?.('cart_view'), [observeShoppingView, store, ready, loadError]);
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    const [busy, setBusy] = useState(false);
    const promoOwner = ready ? store.customer?.id || null : null;
    const promoScopeRef = useRef({ owner: promoOwner, tenure: 0, busy: false, unapplied: false });
    if (promoScopeRef.current.owner !== promoOwner) promoScopeRef.current = { owner: promoOwner, tenure: promoScopeRef.current.tenure + 1, busy: false, unapplied: false };
    const promoScope = promoScopeRef.current;
    const [promoState, setPromoState] = useState({ scope: promoScope, busy: false, unapplied: false });
    const promoBusy = promoState.scope === promoScope && promoState.busy;
    const promoUnapplied = promoState.scope === promoScope && promoState.unapplied;
    function changePromoState(kind: 'busy' | 'unapplied', next: boolean) {
        if (promoScopeRef.current !== promoScope) return;
        promoScope[kind] = next;
        setPromoState(previous => previous.scope === promoScope && previous[kind] === next ? previous : { scope: promoScope, busy: promoScope.busy, unapplied: promoScope.unapplied });
    }
    const q = store.totals;
    const freeStandardThreshold = shippingTerms(ready ? store.config : null).freeThreshold;
    const packSavings = q?.packDiscount ?? q?.discount ?? 0;
    const promoSavings = q?.promoDiscount ?? q?.promo?.savings ?? 0;
    const locked = busy || promoBusy || cartUpdating || cartSync === 'uncertain' || Boolean(store.pricingStale);
    // Preorders are purchased in their own order. A mixed cart keeps one group and removes the other.
    const mixed = ready && mixesPreorder(store.cart, store.products);
    async function keepOnly(preorders: boolean) {
        if (locked) return;
        const isPre = (id: number) => Boolean(store.products.find(p => p.id === id)?.activePreorder);
        setBusy(true);
        try { await saveCart(store.cart.filter(l => isPre(l.id) === preorders), store.cart); } catch (e) { report(e); } finally { setBusy(false); }
    }
    async function update(index: number, delta: number) {
        if (locked) return;
        const next = store.cart.map((l, i) => i === index ? { ...l, quantity: l.quantity + delta } : l).filter(l => l.quantity > 0);
        setBusy(true);
        try { await saveCart(next, store.cart); } catch (e) { report(e); } finally { setBusy(false); }
    }
    async function remove(index: number) {
        if (locked) return;
        const line = store.cart[index];
        setBusy(true);
        try { await saveCart(store.cart.filter((l, i) => line.packId ? l.packId !== line.packId : i !== index), store.cart); }
        catch (e) { report(e); } finally { setBusy(false); }
    }
    if (ready && store.cartConflict) return <CartChoice/>;
    return <><div className="page-heading"><h1>Your Cart</h1></div>
        {store.cartNotice && <p className="notice" role="status">{store.cartNotice}</p>}
        {store.pricingStale && <div className="notice" role="alert"><p>A scheduled offer changed. Refresh your cart to confirm current prices before checkout. Your items are still saved.</p><button type="button" className="text-button" disabled={retrying || cartUpdating} onClick={retryLoad}>{retrying ? 'Refreshing prices…' : 'Refresh current prices'}</button></div>}
        {ready && cartSync && cartSync !== 'current' && <div className="notice" role={cartSync === 'uncertain' ? 'alert' : 'status'}>
            <p>{cartSync === 'uncertain' ? 'The last cart change could not be confirmed. Check the saved cart before making another change or continuing to checkout.' : 'Your cart change was saved. The latest account and cart details could not refresh.'}</p>
            <p>Retry reads your saved cart. It does not repeat the change.</p>
            <button type="button" className="text-button" disabled={retrying || cartUpdating} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry cart access'}</button>
        </div>}
        {!ready ? <div aria-busy={retrying}>
            <p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading your saved cart…'}</p>
            {loadError && <button type="button" className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry cart'}</button>}
        </div> : !store.cart.length && cartSync === 'uncertain' ? <p role="status">Saved cart confirmation is needed.</p> : !store.cart.length ? <Blank title="Your cart is empty."><a className="button button-dark" href="/shop">Explore products</a></Blank> : <div className="cart-layout">
            <div>
                {store.cartError && <div className="notice error"><p>{store.cartError}</p><button className="text-button" disabled={locked} onClick={async () => { setBusy(true); try { await saveCart([], store.cart); } catch (e) { report(e); } finally { setBusy(false); } }}>Clear cart and start again</button></div>}
                {mixed && <div className="notice preorder-checkout-notice" role="alert"><p>{preorderSeparateMessage}</p>
                    <button type="button" className="text-button" disabled={locked} onClick={() => keepOnly(false)}>Check out in-stock items now (remove preorders)</button>{' '}
                    <button type="button" className="text-button" disabled={locked} onClick={() => keepOnly(true)}>Check out preorders now (remove in-stock items)</button></div>}
                {store.cart.map((l, i) => {
                    const p = store.products.find(p => p.id === l.id);
                    return p ? <article className="cart-line" key={i}>
                        <a href={'/product/' + p.slug}><ProductImage product={p} width={98} height={98}/></a>
                        <div><h2><a href={'/product/' + p.slug}>{p.name}</a></h2><p>{compound(p)}</p><p>{p.sizes[0]}{l.packId ? ` · ${l.packSize}-pack${l.packKind === 'fixed' ? ' · Same product' : ' · Mix & match'}` : l.presaleId ? ' · Presale' : ''}</p><strong>{money(q?.items?.[i]?.lineTotal ?? p.price * l.quantity)}</strong><PreorderNotice product={p} compact/></div>
                        {l.packId ? <span>Qty {l.quantity}</span> : <div className="quantity"><button disabled={locked} aria-label={'Decrease ' + p.name} onClick={() => update(i, -1)}><Minus size={14}/></button><span>{l.quantity}</span><button disabled={locked} aria-label={'Increase ' + p.name} onClick={() => update(i, 1)}><Plus size={14}/></button></div>}
                        <button className="icon-button" disabled={locked} aria-label={l.packId ? 'Remove entire ' + l.packSize + '-pack' : 'Remove ' + p.name} onClick={() => remove(i)}><Trash2 size={19}/></button>
                    </article> : null;
                })}
                <a className="text-button" href="/shop">Continue shopping</a>
            </div>
            <aside className="order-summary"><h2>Order Summary</h2>{hasPreorder(q?.items) && <p className="preorder-checkout-notice">{preorderOrderNotice}</p>}
                <PromoCode key={promoScope.tenure} disabled={busy || cartUpdating || cartSync === 'uncertain' || Boolean(store.cartError) || Boolean(store.pricingStale)} onBusyChange={next => changePromoState('busy', next)} onUnappliedChange={next => changePromoState('unapplied', next)}/>
                <div className="summary-lines">
                    <p><span>Subtotal</span><strong>{q ? money(q.subtotal) : 'Unavailable'}</strong></p>
                    {packSavings > 0 && <p><span>Pack savings</span><strong>−{money(packSavings)}</strong></p>}
                    {promoSavings > 0 && <p><span>Promo savings</span><strong>−{money(promoSavings)}</strong></p>}
                    <p><span>Shipping</span><span>{q && freeStandardThreshold !== null && q.total >= freeStandardThreshold ? 'Standard free; upgrades at checkout' : 'At checkout'}</span></p>
                    <p><span>Tax</span><span>At checkout</span></p>
                    <p className="total"><span>Items total</span><strong>{q ? money(q.total) : 'Unavailable'}</strong></p>
                </div>
                {q && freeStandardThreshold !== null && q.total < freeStandardThreshold && <p className="muted">Add {money(freeStandardThreshold - q.total)} for free standard shipping. Faster options are priced separately.</p>}
                <a className="button button-gold" href={store.cartError || locked || promoUnapplied || mixed ? undefined : '/checkout'} aria-disabled={Boolean(store.cartError) || locked || promoUnapplied || mixed} onClick={e => { if (store.cartError || locked || mixed || promoScopeRef.current !== promoScope || promoScope.busy || promoScope.unapplied) e.preventDefault(); }}>Proceed to checkout</a>
                {mixed && <p className="muted">Preorders and in-stock items check out separately. Remove one group above to continue.</p>}
                <p className="muted">{store.payment.enabled ? store.payment.state === 'sandbox' ? 'Test checkout only. Real payments are not accepted.' : 'Secure card payment is available at checkout.' : 'Checkout is not accepting payments yet. Your cart stays saved.'}</p>
            </aside>
        </div>}
    </>;
}
export function AddressFields({ initial = {} }: {
    initial?: Record<string, string>;
}) { return <><Field label="Full name" name="name" defaultValue={initial.name}/><Field label="Street address" name="line1" defaultValue={initial.line1}/><Field label="Apartment / suite (optional)" name="line2" defaultValue={initial.line2} required={false}/><div className="form-row"><Field label="City" name="city" defaultValue={initial.city}/><Field label="State (2 letters)" name="state" defaultValue={initial.state} placeholder="CA"/><Field label="ZIP code" name="zip" defaultValue={initial.zip}/></div><Field label="Phone" name="phone" type="tel" defaultValue={initial.phone}/><input type="hidden" name="country" value="US"/><p className="muted">United States delivery only.</p></>; }
export function Checkout() {
    const { store, ready, loadError, cartSync = 'current', cartUpdating = false, refresh, measureShopping, observeShoppingView, validShoppingQuote, validShoppingHandoff } = useStore();
    useEffect(() => observeShoppingView?.(store.customer ? 'checkout_form_view' : 'checkout_signin_view'), [observeShoppingView, store, ready, loadError]);
    type Scope = { owner: string | null; tenure: number; lifetime: number; active: boolean };
    type Operation = { scope: Scope; lifetime: number };
    type CheckoutView = { scope: Scope; lifetime: number; accepted: boolean; deliveryQuote: { data: any; context: string } | null; address: any; requestKey: string };
    const owner = ready ? store.customer?.id || null : null;
    const scopeRef = useRef<Scope>({ owner, tenure: 0, lifetime: 0, active: false });
    if (scopeRef.current.owner !== owner) scopeRef.current = { owner, tenure: scopeRef.current.tenure + 1, lifetime: 0, active: false };
    const scope = scopeRef.current;
    const renderedLifetime = scope.lifetime;
    const [view, setView] = useState<CheckoutView>({ scope, lifetime: 0, accepted: false, deliveryQuote: null, address: null, requestKey: '' });
    const [activeRequest, setActiveRequest] = useState<Operation | null>(null);
    const [activePromo, setActivePromo] = useState<Operation | null>(null);
    const [activePromoDraft, setActivePromoDraft] = useState<Operation | null>(null);
    const operation = useRef<Operation | null>(null);
    const promoOperation = useRef<Operation | null>(null);
    const unappliedPromo = useRef<Operation | null>(null);
    const quoteRevision = useRef(0);
    const current = (request: Operation) => request.scope === scopeRef.current && request.scope.active && request.lifetime === request.scope.lifetime;
    const currentView = view.scope === scope && view.lifetime === scope.lifetime ? view : null;
    const accepted = currentView?.accepted || false;
    const deliveryQuote = currentView?.deliveryQuote;
    const address = currentView?.address;
    const requestKey = currentView?.requestKey || '';
    const busy = Boolean(activeRequest && current(activeRequest));
    const promoBusy = Boolean(activePromo && current(activePromo));
    const promoUnapplied = Boolean(activePromoDraft && current(activePromoDraft));
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    useEffect(() => {
        scope.active = true;
        scope.lifetime += 1;
        quoteRevision.current += 1;
        operation.current = null;
        promoOperation.current = null;
        unappliedPromo.current = null;
        setActiveRequest(null);
        setActivePromo(null);
        setActivePromoDraft(null);
        setView({ scope, lifetime: scope.lifetime, accepted: false, deliveryQuote: null, address: null, requestKey: crypto.randomUUID() });
        return () => { scope.active = false; scope.lifetime += 1; };
    }, [scope]);
    const q = store.totals;
    const quoteContext = JSON.stringify([owner, scope.tenure, store.cart, store.cartConflict?.id, q?.total, q?.promo?.code || '', Boolean(cartUpdating), cartSync === 'uncertain', Boolean(store.pricingStale)]);
    const renderedQuoteRevision = quoteRevision.current;
    const currentContext = useRef(quoteContext);
    currentContext.current = quoteContext;
    const delivery = deliveryQuote?.context === quoteContext ? deliveryQuote.data : null;
    const packSavings = q?.packDiscount ?? q?.discount ?? 0;
    const promoSavings = q?.promoDiscount ?? q?.promo?.savings ?? 0;
    function invalidateDelivery() {
        if (!current({ scope, lifetime: renderedLifetime })) return;
        quoteRevision.current += 1;
        setView(previous => previous.scope === scope && previous.lifetime === scope.lifetime ? { ...previous, deliveryQuote: null, address: null } : previous);
    }
    useEffect(() => { invalidateDelivery(); }, [quoteContext]);
    function changePromoBusy(next: boolean) {
        const request = { scope, lifetime: renderedLifetime };
        if (!current(request)) return;
        promoOperation.current = next ? request : null;
        setActivePromo(next ? request : null);
        if (next) invalidateDelivery();
    }
    function changeUnappliedPromo(next: boolean) {
        const request = { scope, lifetime: renderedLifetime };
        if (!current(request)) return;
        const wasUnapplied = Boolean(unappliedPromo.current && current(unappliedPromo.current));
        unappliedPromo.current = next ? request : null;
        setActivePromoDraft(previous => next ? previous && current(previous) ? previous : request : null);
        if (next && !wasUnapplied) invalidateDelivery();
    }
    function setAccepted(next: boolean) {
        if (!current({ scope, lifetime: renderedLifetime })) return;
        setView(previous => previous.scope === scope && previous.lifetime === scope.lifetime ? { ...previous, accepted: next } : previous);
    }
    if (!ready) return <section aria-busy={retrying}>
        <div className="page-heading"><h1>Checkout</h1></div>
        <p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading checkout…'}</p>
        {loadError && <button type="button" className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry checkout'}</button>}
    </section>;
    if (cartSync === 'uncertain') return <section>
        <div className="page-heading"><h1>Review your saved cart</h1></div>
        <p role="alert">The last cart change could not be confirmed. Retry reads your saved cart without repeating the change.</p>
        <button type="button" className="button button-dark" disabled={retrying || cartUpdating} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry cart access'}</button>
        <p><a href="/cart">Return to your cart</a></p>
    </section>;
    if (store.pricingStale) return <section><div className="page-heading"><h1>Confirm current prices</h1></div><p role="alert">A scheduled offer changed. Refresh prices before continuing. Your cart is saved.</p><button type="button" className="button button-dark" disabled={retrying || cartUpdating} onClick={retryLoad}>{retrying ? 'Refreshing prices…' : 'Refresh current prices'}</button></section>;
    if (store.cartConflict) return <CartChoice/>;
    if (!store.payment.enabled) return <section className="checkout-unavailable"><h1>Checkout is not open yet.</h1><p>Your cart stays saved with your shopping session. We are preparing secure checkout and will accept orders once it is ready.</p><div className="checkout-unavailable-actions"><a className="button button-dark" href="/cart">Return to your cart</a><a href="/shop">Keep shopping</a><a href="/contact">Contact Biomod</a></div></section>;
    if (store.cartError) return <Blank title="Your cart needs a review."><p>{store.cartError}</p><a className="button button-dark" href="/cart">Review your cart</a></Blank>;
    if (!store.customer) return <AuthPage returnTo="/checkout"/>;
    if (!store.cart.length) return <Blank title="Your cart is empty."><a href="/shop">Shop products</a></Blank>;
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const request = { scope, lifetime: renderedLifetime };
        if (!current(request) || operation.current || promoOperation.current || unappliedPromo.current || cartUpdating) return;
        operation.current = request;
        setActiveRequest(request);
        invalidateDelivery();
        const revision = quoteRevision.current;
        const context = currentContext.current;
        try {
            const fields = formData(e.currentTarget);
            const data = await api('delivery', { address: fields });
            if (!current(request) || operation.current !== request || revision !== quoteRevision.current || context !== currentContext.current || promoOperation.current || unappliedPromo.current) return;
            setView(previous => previous.scope === scope && previous.lifetime === request.lifetime ? { ...previous, address: fields, deliveryQuote: { data, context } } : previous);
            if (validShoppingQuote?.(data)) measureShopping?.('delivery_quote_confirmed');
        } catch (e) {
            if (current(request) && revision === quoteRevision.current) report(e);
        } finally {
            if (operation.current === request) {
                operation.current = null;
                if (current(request)) setActiveRequest(null);
            }
        }
    }
    async function selectDelivery(shippingOptionId: string) {
        const request = { scope, lifetime: renderedLifetime };
        if (!current(request) || renderedQuoteRevision !== quoteRevision.current || !delivery || !address || operation.current || promoOperation.current || unappliedPromo.current || cartUpdating || shippingOptionId === delivery.shippingOptionId) return;
        if (!delivery.shippingOptions?.some((option: ShippingOption) => option.id === shippingOptionId)) return;
        operation.current = request;
        setActiveRequest(request);
        const revision = ++quoteRevision.current;
        const context = currentContext.current;
        try {
            const data = await api('delivery', { address, quoteId: delivery.quoteId, shippingOptionId });
            if (!current(request) || operation.current !== request || revision !== quoteRevision.current || context !== currentContext.current || promoOperation.current || unappliedPromo.current) return;
            if (data.shippingOptionId !== shippingOptionId) throw new Error('Your delivery choice could not be confirmed. Recalculate delivery.');
            setView(previous => previous.scope === scope && previous.lifetime === request.lifetime ? { ...previous, deliveryQuote: { data, context } } : previous);
        } catch (e) {
            if (current(request) && operation.current === request && revision === quoteRevision.current && context === currentContext.current) {
                invalidateDelivery();
                report(e);
            }
        } finally {
            if (operation.current === request) {
                operation.current = null;
                if (current(request)) setActiveRequest(null);
            }
        }
    }
    async function checkout() {
        const request = { scope, lifetime: renderedLifetime };
        if (!current(request) || renderedQuoteRevision !== quoteRevision.current || !delivery || !accepted || !requestKey || operation.current || promoOperation.current || unappliedPromo.current || !store.payment.enabled || cartUpdating) return;
        operation.current = request;
        setActiveRequest(request);
        const context = currentContext.current, revision = quoteRevision.current;
        try {
            const d = await api('checkout', { address, accepted, requestKey, expectedTotal: delivery.total, quoteId: delivery.quoteId, shippingOptionId: delivery.shippingOptionId });
            // A response belongs to the account and mounted checkout that sent
            // it. Never redirect a later owner or a page which has been left.
            if (!current(request) || operation.current !== request) return;
            if (context === currentContext.current && revision === quoteRevision.current
                && !promoOperation.current && !unappliedPromo.current && validShoppingHandoff?.(d.url)) measureShopping?.('checkout_handoff_ready');
            location.assign(d.url);
        } catch (e) {
            if (current(request) && operation.current === request) {
                report(e);
                operation.current = null;
                setActiveRequest(null);
            }
        }
    }
    return <><div className="page-heading"><h1>Checkout</h1></div>
        {store.payment.state === 'sandbox' && <p className="notice">Test checkout only. This payment environment does not accept real payments.</p>}
        <div className="cart-layout">
            <form key={scope.tenure} className="store-form" onSubmit={submit} onChange={invalidateDelivery}>
                <h2>Delivery address</h2><AddressFields initial={{ name: store.customer.name }}/>
                <button className="button button-dark" disabled={busy || promoBusy || promoUnapplied || cartUpdating}>{busy ? 'Calculating…' : 'Calculate delivery and tax'}</button>
            </form>
            <aside className="order-summary"><h2>Your order</h2>{hasPreorder(q?.items) && <p className="preorder-checkout-notice">{preorderOrderNotice}</p>}
                {q?.items.map((l: any, i: number) => <p className="summary-product" key={i}><span>{l.product.name} × {l.quantity}{l.product.activePreorder && <small className="preorder-line-note">Preorder · {l.product.activePreorder.percentOff}% off included · Estimated dispatch {l.product.activePreorder.ships}</small>}</span><strong>{money(l.lineTotal ?? l.product.price * l.quantity)}</strong></p>)}
                <PromoCode key={scope.tenure} disabled={busy || cartUpdating} onBusyChange={changePromoBusy} onUnappliedChange={changeUnappliedPromo} onChange={invalidateDelivery}/>
                {delivery?.shippingOptions?.length > 0 && <fieldset className="checkout-delivery" disabled={busy || promoBusy || promoUnapplied || cartUpdating} aria-describedby="delivery-timing">
                    <legend>Choose delivery</legend>
                    {(delivery.shippingOptions as ShippingOption[]).map(option => <label className="checkout-delivery-option" key={option.id} data-selected={delivery.shippingOptionId === option.id}>
                        <input type="radio" name="deliveryOption" value={option.id} checked={delivery.shippingOptionId === option.id} onChange={() => void selectDelivery(option.id)}/>
                        {option.serviceKey ? <span><strong className="checkout-delivery-heading"><span>{option.shippingService}</span><span>{option.free ? 'Free' : money(option.shipping)}</span></strong>
                            {option.note && <span className="checkout-delivery-detail">{option.note}</span>}
                            {option.days !== null && <span className="checkout-delivery-detail">Carrier estimate: {option.days} business {option.days === 1 ? 'day' : 'days'} after dispatch</span>}
                        </span> : <span><strong className="checkout-delivery-heading"><span>{option.tier === 'overnight' ? 'Overnight' : option.tier === 'expedited' ? 'Expedited' : 'Standard'}</span><span>{option.free ? 'Free' : money(option.shipping)}</span></strong><span className="checkout-delivery-detail">{option.shippingService}</span>
                            {option.days !== null && <span className="checkout-delivery-detail">Carrier estimate: {option.days} business {option.days === 1 ? 'day' : 'days'} after dispatch</span>}
                            {!option.free && option.handlingCents > 0 && option.carrierCents !== null && <span className="checkout-delivery-detail">{money(option.carrierCents)} carrier rate + {money(option.handlingCents)} handling</span>}
                        </span>}
                    </label>)}
                    <p id="delivery-timing" className="checkout-delivery-timing">Transit starts after dispatch. Preorder dispatch dates still apply. Weekends, holidays and carrier cutoffs may affect arrival.</p>
                    {busy && <p role="status">Confirming delivery and tax…</p>}
                </fieldset>}
                <div className="summary-lines">
                    <p><span>Subtotal</span><strong>{q ? money(q.subtotal) : 'Unavailable'}</strong></p>
                    {packSavings > 0 && <p><span>Pack savings</span><strong>−{money(packSavings)}</strong></p>}
                    {promoSavings > 0 && <p><span>Promo savings</span><strong>−{money(promoSavings)}</strong></p>}
                    <p><span>Items total</span><strong>{q ? money(q.total) : 'Unavailable'}</strong></p>
                    <p><span>Shipping{delivery?.shippingService && <small className="checkout-selected-service">{delivery.shippingService}</small>}</span><strong>{delivery ? money(delivery.shipping) : 'Pending address'}</strong></p>
                    <p><span>Tax</span><strong>{delivery ? money(delivery.tax) : 'Pending address'}</strong></p>
                    {delivery && <p className="total"><span>Total</span><strong>{money(delivery.total)}</strong></p>}
                </div>
                <Check checked={accepted} onChange={setAccepted}>I am 21 or older and purchasing exclusively for laboratory research. I agree to the <a href="/terms-of-sale">terms of sale</a>.</Check>
                <button className="button button-gold" disabled={!delivery || !accepted || !requestKey || busy || promoBusy || promoUnapplied || !store.payment.enabled || cartUpdating} onClick={() => void checkout()}>Continue to secure payment</button>
                <p className="muted">Card information is entered on Authorize.net’s secure payment page.</p>
            </aside>
        </div>
    </>;
}
const accountNav = [['Overview', ''], ['Orders', 'orders'], ['Addresses', 'addresses'], ['Wishlist', 'wishlist'], ['Rewards', 'rewards'], ['Notifications', 'notifications'], ['Profile', 'profile']];
export function Account({ section = '' }: {
    section?: string;
}) {
    type Scope = { owner: string; version: number };
    const { store, ready, loadError, refresh, reorder } = useStore();
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    const owner = ready ? store.customer?.id || null : null;
    const latestOwner = useRef(owner);
    latestOwner.current = owner;
    const version = useRef(0);
    const ownerScope = useRef({ owner, active: false });
    if (ownerScope.current.owner !== owner) ownerScope.current = { owner, active: false };
    const activeOwner = ownerScope.current;
    const operation = useRef<Scope | null>(null);
    const [view, setView] = useState<{ owner: string | null; data: any; error: string; loading: boolean }>({ owner, data: null, error: '', loading: false });
    const [busy, setBusy] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const current = (scope: Scope) => activeOwner.active && ownerScope.current === activeOwner && latestOwner.current === scope.owner && version.current === scope.version;
    async function load() {
        if (!owner || !activeOwner.active || ownerScope.current !== activeOwner || latestOwner.current !== owner) return;
        // Existing successful actions may request a newer read while a retry is
        // pending. Only the most recently requested account snapshot may win.
        const scope = { owner, version: ++version.current };
        operation.current = scope;
        setView(previous => ({ ...previous, loading: true }));
        try {
            const result = await api('account');
            if (!['orders', 'addresses', 'rewards', 'requests'].every(key => Array.isArray(result?.[key]))) throw new Error('Account details unavailable');
            if (current(scope)) {
                setView({ owner, data: result, error: '', loading: false });
                setAccepted(Boolean(result.profile?.research_accepted));
            }
        } catch {
            if (current(scope)) setView(previous => ({ ...previous, error: previous.data
                ? 'Account details could not refresh. Your last loaded information is still shown. Please retry.'
                : 'Your account details could not load. Please retry.' }));
        } finally {
            if (operation.current === scope) operation.current = null;
            if (current(scope)) setView(previous => ({ ...previous, loading: false }));
        }
    }
    function retryDetails() { if (!operation.current) void load(); }
    useEffect(() => {
        activeOwner.active = true;
        version.current += 1;
        operation.current = null;
        setView({ owner, data: null, error: '', loading: false });
        setAccepted(false);
        if (owner) void load();
        return () => { activeOwner.active = false; version.current += 1; operation.current = null; };
    }, [owner]);
    const shown = view.owner === owner ? view : { data: null, error: '', loading: true };
    const data = shown.data;
    const accessFailure = ready && loadError ? <div><p className="notice error" role="alert">Account access could not refresh. The last loaded information is still shown.</p><button className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry account access'}</button></div> : null;
 async function submit(e: FormEvent<HTMLFormElement>, action: string) { e.preventDefault(); setBusy(true); try {
    const d = await api(action, { ...formData(e.currentTarget), accepted });
    toast.success(d.message);
    await load();
}
catch (e) {
    report(e);
}
finally {
    setBusy(false);
} } if (!ready) return <><h1>My Account</h1>{loadError ? <><p className="notice error" role="alert">{loadError}</p><button className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry account access'}</button></> : <p role="status">Loading your account…</p>}</>;
    if (store.cartConflict && !section) return <CartChoice/>; if (section === 'wishlist')
    return <><div className="page-heading"><h1>Your Wishlist</h1></div>{accessFailure}{store.wishlist.length ? <div className="product-grid">{store.products.filter(p => store.wishlist.includes(p.id)).map(p => <ProductCard key={p.id} product={p}/>)}</div> : <Blank title="Your wishlist is empty.">Use the heart on a product to save it here.</Blank>}</>; if (!store.customer)
    return <AuthPage returnTo={'/account/' + section}/>; return <><div className="page-heading"><h1>My Account</h1></div>{store.admin && <section className="notice" aria-labelledby="account-store-management"><h2 id="account-store-management">Store management</h2><p>Manage customer orders and track affiliate and promo code use in your store dashboard. The account below shows your own purchases.</p><p><a className="text-button" href="/admin?tab=orders">Store orders</a> · <a className="text-button" href="/admin?tab=promos">Affiliate &amp; promo codes</a></p></section>}<div className="account-layout"><aside className="account-nav"><p>{store.customer.email}</p>{accountNav.map(([name, path]) => <a className={section === path ? 'active' : ''} key={path} href={'/account/' + path}>{store.admin && path === 'orders' ? 'My purchases' : name}</a>)}{store.admin && <><a href="/admin?tab=orders">Store orders</a><a href="/admin?tab=promos">Affiliate &amp; promo codes</a></>}<button onClick={() => api('auth-logout', {}).then(() => location.assign('/login')).catch(report)}>Sign out</button></aside><div className="account-body" aria-busy={shown.loading}>{accessFailure}{shown.error && <><p className="notice error" role="alert">{shown.error}</p><button className="button button-dark" disabled={shown.loading} onClick={retryDetails}>{shown.loading ? 'Refreshing account details…' : 'Retry account details'}</button></>}{!data ? (!shown.error && <p role="status">Loading account details…</p>) : section === 'orders' ? <><h2>{store.admin ? 'My purchases' : 'Orders'}</h2>{!data.orders.length ? <Blank title="No orders yet."><a href="/shop">Explore the catalog</a></Blank> : data.orders.map((o: any) => <article className="account-record" key={o.id}><h3>Order {o.id.slice(0, 8)}</h3><p className="order-status-row"><CustomerStatus order={o}/> {new Date(o.created).toLocaleDateString()} · {money(o.total)}</p><p className="muted">{fulfillmentLabel(o)}</p>{o.data.shippingService && <p>Delivery service: {o.data.shippingService}{Number.isFinite(o.data.shipping) ? ' · ' + money(o.data.shipping) : ''}</p>}{o.data.recovery?.savings > 0 && <p>Additional 7.5% recovery discount: {money(o.data.recovery.savings)}. Your previous discounts remain applied.</p>}{o.data.items?.map((i: any, n: number) => <p key={n}>{i.product.name} × {i.quantity}{Number.isSafeInteger(i.lineTotal) && <> · {money(i.lineTotal)}</>} {i.product.soldBatch?.lot && <span> · Ordered lot: {i.product.soldBatch.lot}</span>} {i.product.activePreorder && <span> · Preorder · {i.product.activePreorder.percentOff}% off included · Estimated dispatch {i.product.activePreorder.ships}</span>} {!i.unavailable&&<a className="order-document-link" href={'/testing?product='+i.product.id}>Current product documentation</a>}</p>)}{!o.data.catalogUnavailable&&['paid','shipped','delivered'].includes(o.status)&&<button className="button button-dark" disabled={busy} onClick={async()=>{setBusy(true);try{await reorder(o.data.items);location.assign('/cart');}catch(e){report(e);}finally{setBusy(false);}}}>{busy?'Adding…':'Reorder at current prices'}</button>}{o.data.catalogUnavailable&&<p className="notice">This order contains an archived product. Contact Biomod for order support.</p>}{o.data.tracking && <p>Tracking: {o.data.tracking}</p>}{(() => { const resumable = !o.data.internalTest && !o.data.catalogUnavailable && ['awaiting_payment', 'pending'].includes(o.status); const check = () => api('reconcile', { id: o.id }).then(d => { toast.info(d.message || d.status); load(); }).catch(report); return <>{resumable && <button className="button button-dark" onClick={() => api('resume', { id: o.id }).then(d => location.assign(d.url)).catch(report)}>Resume checkout</button>}{!['paid', 'shipped', 'delivered'].includes(o.status) && <button className={resumable ? 'text-button' : 'button button-dark'} onClick={check}>{resumable ? 'Already paid? Check payment status' : 'Check payment status'}</button>}</>; })()}</article>)}</> : section === 'addresses' ? <><h2>Saved addresses</h2>{data.addresses.map((a: any) => <article className="account-record" key={a.id}><strong>{a.name}</strong><p>{a.line1} {a.line2}<br />{a.city}, {a.state} {a.zip}</p><button className="text-button" onClick={() => api('address', { id: a.id, remove: true }).then(load).catch(report)}>Remove</button></article>)}<form className="store-form" onSubmit={e => submit(e, 'address')}><h3>Add an address</h3><AddressFields /><button className="button button-dark" disabled={busy}>Save address</button></form></> : section === 'profile' ? <form className="store-form" onSubmit={e => submit(e, 'profile')}><h2>Profile</h2><Field label="Full name" name="name" defaultValue={data.profile?.name || store.customer.name}/><Field label="Phone" name="phone" type="tel" defaultValue={data.profile?.phone}/><Field label="Institution / company" name="company" defaultValue={data.profile?.company}/><Check checked={accepted} onChange={setAccepted}>My purchases are exclusively for laboratory research.</Check><button className="button button-dark" disabled={busy}>Save profile</button></form> : section === 'rewards' ? <><h2>Rewards</h2>{!store.config.rewardsEnabled ? <Blank title="Rewards are not active yet.">Program details will appear here when released.</Blank> : <><p className="reward-total">{data.rewards.reduce((s: number, r: any) => s + r.points, 0)} points</p>{data.rewards.length ? data.rewards.map((r: any, i: number) => <p key={i}>{r.reason}: {r.points} points · {new Date(r.created).toLocaleDateString()}</p>) : <p>No rewards have been earned yet.</p>}</>}</> : section === 'notifications' ? <><h2>Notifications</h2>{data.requests.length ? data.requests.map((r: any) => <article className="account-record" key={r.id}><strong>{r.kind === 'stock' ? 'Restock request' : r.kind === 'affiliate' ? 'Partner application' : 'Support message'}</strong><p>{({ new: 'New', in_progress: 'In review', reviewed: 'Reviewed', resolved: 'Resolved', spam: 'Closed' } as Record<string, string>)[r.status] || 'In review'} · {new Date(r.created).toLocaleDateString()}</p></article>) : <Blank title="No notifications.">Your requests and updates will appear here.</Blank>}</> : section === 'affiliate' ? <AffiliateProgram/> : <><h2>Welcome{store.customer.name ? ', ' + store.customer.name : ''}.</h2><p>{store.admin ? 'Manage your own purchases, addresses, saved products, and research account.' : 'Manage your orders, addresses, saved products, and research account.'}</p><div className="account-overview"><a href="/account/orders"><strong>{data.orders.length}</strong>{store.admin ? 'My purchases' : 'Orders'}</a><a href="/account/wishlist"><strong>{store.wishlist.length}</strong>Saved products</a><a href="/account/addresses"><strong>{data.addresses.length}</strong>Addresses</a></div></>}</div></div></>; }
export function PaymentReturn() {
    type ReturnOrder = { id: string; status: string; total: number; data?: { shipment?: { status?: string } } };
    type Scope = { owner: string; version: number };
    const { store, ready, loadError, refresh } = useStore();
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    const owner = ready ? store.customer?.id || null : null;
    const latestOwner = useRef(owner);
    latestOwner.current = owner;
    const version = useRef(0);
    const operation = useRef<Scope | null>(null);
    const [view, setView] = useState<{ owner: string | null; orders: ReturnOrder[] | null; error: string; busy: string }>({ owner, orders: null, error: '', busy: '' });
    const current = (scope: Scope) => latestOwner.current === scope.owner && version.current === scope.version;
    const statuses: Record<string, string> = { creating: 'Checkout being prepared', awaiting_payment: 'Awaiting payment confirmation', pending: 'Payment confirmation pending', review: 'Payment requires review', paid: 'Payment confirmed', labeling: 'Preparing shipment', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', canceled: 'Cancelled', refunded: 'Refunded', failed: 'Payment unsuccessful' };
    const complete = ['paid', 'labeling', 'shipped', 'delivered'];
    const verifiable = ['creating', 'awaiting_payment', 'pending', 'review'];

    async function readOrders(scope: Scope) {
        const data = await api('account');
        if (!Array.isArray(data.orders)) throw new Error('Order list unavailable');
        if (current(scope)) setView(previous => ({ ...previous, owner: scope.owner, orders: data.orders, error: '' }));
    }
    async function loadOrders(scope: Scope) {
        if (!current(scope) || operation.current) return;
        operation.current = scope;
        setView(previous => ({ ...previous, busy: 'loading' }));
        try { await readOrders(scope); }
        catch {
            if (current(scope)) setView(previous => ({ ...previous, error: previous.orders ? 'The order list could not refresh. Your last loaded statuses are still shown. Please retry.' : 'Your orders could not load. Please retry to check payment status.' }));
        }
        finally {
            if (operation.current === scope) operation.current = null;
            if (current(scope)) setView(previous => ({ ...previous, busy: '' }));
        }
    }
    useEffect(() => {
        const revision = ++version.current;
        operation.current = null;
        setView({ owner, orders: null, error: '', busy: '' });
        if (owner) void loadOrders({ owner, version: revision });
        return () => { version.current += 1; operation.current = null; };
    }, [owner]);

    async function verify(id: string) {
        if (!owner || operation.current) return;
        const scope = { owner, version: version.current };
        if (!current(scope)) return;
        operation.current = scope;
        setView(previous => ({ ...previous, error: '', busy: id }));
        try {
            const result = await api('reconcile', { id });
            if (!current(scope)) return;
            if (![...complete, 'pending', 'review'].includes(result.status)) throw new Error('Payment status unavailable');
            setView(previous => ({ ...previous, orders: previous.orders?.map(order => order.id === id ? { ...order, status: result.status } : order) || null }));
            try { await readOrders(scope); }
            catch {
                if (current(scope)) setView(previous => ({ ...previous, error: 'Payment was checked, but the order list could not refresh. The last verified status is still shown. Please retry the order list.' }));
            }
        }
        catch {
            if (current(scope)) setView(previous => ({ ...previous, error: 'Payment status could not be verified. Your last loaded statuses are still shown. Check again or contact us before attempting another payment.' }));
        }
        finally {
            if (operation.current === scope) operation.current = null;
            if (current(scope)) setView(previous => ({ ...previous, busy: '' }));
        }
    }

    if (!ready) return <><h1>Payment status</h1>{loadError ? <><p className="notice error" role="alert">{loadError}</p><button className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry account access'}</button></> : <p role="status">Loading secure account access…</p>}</>;
    if (!owner) return <AuthPage returnTo="/payment/return"/>;
    const shown = view.owner === owner ? view : { orders: null, error: '', busy: 'loading' };
    return <>
        <h1>Payment status</h1>
        <p>Returning from the payment page does not by itself confirm payment. Check the status of your order below.</p>
        {shown.error && <p className="notice error" role="alert">{shown.error}</p>}
        {!shown.orders && !shown.error && <p role="status">Loading your orders…</p>}
        {shown.error && <button className="button button-dark" disabled={Boolean(shown.busy)} onClick={() => void loadOrders({ owner, version: version.current })}>{shown.busy === 'loading' ? 'Refreshing orders…' : 'Retry order list'}</button>}
        {shown.orders && (shown.orders.length ? <>
            <p>Your recent orders are listed below, including earlier purchases.</p>
            {shown.orders.map(order => <article className="account-record" key={order.id}>
                <h2>Order {order.id.slice(0, 8)}</h2>
                <p>{money(order.total)}</p>
                <p role="status"><strong>{['paid', 'labeling', 'shipped', 'delivered'].includes(order.status) ? fulfillmentLabel(order) : statuses[order.status] || order.status.replaceAll('_', ' ')}</strong></p>
                {order.status === 'pending' || order.status === 'awaiting_payment' ? <p>A completed payment has not yet been confirmed. Verify the status before trying to pay again.</p> : order.status === 'review' ? <p>This order needs review. Contact us before attempting another payment.</p> : null}
                {verifiable.includes(order.status) && <button className="button button-dark" disabled={Boolean(shown.busy)} onClick={() => verify(order.id)}>{shown.busy === order.id ? 'Verifying payment…' : 'Verify payment'}</button>}
            </article>)}
        </> : <p role="status">No orders were found for this signed-in account. If you used another email at checkout, sign in with that email or contact us.</p>)}
        <p><a href="/account/orders">View my orders</a> · <a href="/contact">Contact Biomod</a></p>
    </>;
}

function CustomerStatus({ order }: { order: any }) { const s = customerOrderStatus(order); return <span className={'order-status order-status-' + s.tone}>{s.label}</span>; }
