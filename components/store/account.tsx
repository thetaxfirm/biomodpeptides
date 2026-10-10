'use client';
import { ProductImage } from './product-image';
import { authLink, safeAuthReturn } from '@/lib/auth-return';
import { useEffect, useRef, useState, FormEvent } from 'react';
import { PromoCode } from './promo-code';
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
}) { const { store, ready, loadError, refresh } = useStore(); const destination = safeAuthReturn(returnTo); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const register = mode === 'register', recover = mode === 'forgot-password', reset = mode === 'reset-password'; const title = register ? 'Become a member' : recover ? 'Reset your password' : reset ? 'Choose a new password' : 'Sign in'; async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setMessage(''); try {
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
} } if (!ready) return <div className="auth-page"><h1>{title}</h1><p role="status">{loadError || 'Loading secure account access…'}</p>{loadError && <button className="button button-dark" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); } catch (e) { report(e); } finally { setBusy(false); } }}>Retry account access</button>}</div>; if (!store.authReady) return <div className="auth-page"><h1>Customer accounts are coming soon.</h1><p>You can explore the collection and save products or packs with your shopping session.</p><div className="checkout-unavailable-actions"><a className="button button-dark" href="/shop">Explore products</a><a href="/multi-pack">Your saved packs</a><a href="/contact">Contact Biomod</a></div></div>; return <div className="auth-page"><h1>{title}</h1>{!store.authReady && <p className="notice">Customer sign-in is being connected. Account forms will become available when setup is complete.</p>}<form onSubmit={submit} className="store-form">{register && <><p className="muted">Membership is for research institutions and professionals. We will email you a link to verify your address before you can sign in.</p><Field label="Full name" name="name"/><Field label="Phone" name="phone" type="tel"/><Field label="Business name" name="company"/><Field label="Type of business" name="businessType"><select name="businessType" required defaultValue=""><option value="" disabled>Choose one</option>{businessTypes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field></>}{!reset && <Field label="Email address" name="email" type="email"/>}{!recover && <><label className="field"><span>Password {register && '(at least 8 characters)'}</span><div className="password-field"><input name="password" type={show ? 'text' : 'password'} required minLength={register || reset ? 8 : undefined} autoComplete={register ? 'new-password' : 'current-password'}/><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div></label>{(register || reset) && <Field label="Confirm password" name="confirmPassword" type="password"/>}</>}<button className="button button-dark" disabled={busy || !store.authReady}>{busy ? 'Please wait…' : title}</button>{message && <p className="notice" role="status">{message}</p>}</form>{mode === 'login' ? <div className="auth-links">{store.googleReady && <a className="button button-dark" href="/auth/google">Continue with Google</a>}<a href={authLink('forgot-password', destination)}>Forgot password?</a><p>New to Biomod? <a href={authLink('register', destination)}>Become a member</a></p></div> : <a href={authLink('login', destination)}>Back to sign in</a>}</div>; }

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
    const { store, ready, loadError, refresh, saveCart } = useStore();
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    const [busy, setBusy] = useState(false);
    const [promoBusy, setPromoBusy] = useState(false);
    const q = store.totals;
    const packSavings = q?.packDiscount ?? q?.discount ?? 0;
    const promoSavings = q?.promoDiscount ?? q?.promo?.savings ?? 0;
    const locked = busy || promoBusy;
    async function update(index: number, delta: number) {
        if (locked) return;
        const next = store.cart.map((l, i) => i === index ? { ...l, quantity: l.quantity + delta } : l).filter(l => l.quantity > 0);
        setBusy(true);
        try { await saveCart(next); } catch (e) { report(e); } finally { setBusy(false); }
    }
    async function remove(index: number) {
        if (locked) return;
        const line = store.cart[index];
        setBusy(true);
        try { await saveCart(store.cart.filter((l, i) => line.packId ? l.packId !== line.packId : i !== index)); }
        catch (e) { report(e); } finally { setBusy(false); }
    }
    if (ready && store.cartConflict) return <CartChoice/>;
    return <><div className="page-heading"><h1>Your Cart</h1></div>
        {store.cartNotice && <p className="notice" role="status">{store.cartNotice}</p>}
        {!ready ? <div aria-busy={retrying}>
            <p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading your saved cart…'}</p>
            {loadError && <button type="button" className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry cart'}</button>}
        </div> : !store.cart.length ? <Blank title="Your cart is empty."><a className="button button-dark" href="/shop">Explore products</a></Blank> : <div className="cart-layout">
            <div>
                {store.cartError && <div className="notice error"><p>{store.cartError}</p><button className="text-button" disabled={locked} onClick={async () => { setBusy(true); try { await saveCart([]); } catch (e) { report(e); } finally { setBusy(false); } }}>Clear cart and start again</button></div>}
                {store.cart.map((l, i) => {
                    const p = store.products.find(p => p.id === l.id);
                    return p ? <article className="cart-line" key={i}>
                        <a href={'/product/' + p.slug}><ProductImage product={p} width={98} height={98}/></a>
                        <div><h2><a href={'/product/' + p.slug}>{p.name}</a></h2><p>{compound(p)}</p><p>{p.sizes[0]}{l.packId ? ` · ${l.packSize}-pack${l.packKind === 'fixed' ? ' · Same product' : ' · Mix & match'}` : l.presaleId ? ' · Presale' : ''}</p><strong>{money(q?.items?.[i]?.lineTotal ?? p.price * l.quantity)}</strong></div>
                        {l.packId ? <span>Qty {l.quantity}</span> : <div className="quantity"><button disabled={locked} aria-label={'Decrease ' + p.name} onClick={() => update(i, -1)}><Minus size={14}/></button><span>{l.quantity}</span><button disabled={locked} aria-label={'Increase ' + p.name} onClick={() => update(i, 1)}><Plus size={14}/></button></div>}
                        <button className="icon-button" disabled={locked} aria-label={l.packId ? 'Remove entire ' + l.packSize + '-pack' : 'Remove ' + p.name} onClick={() => remove(i)}><Trash2 size={19}/></button>
                    </article> : null;
                })}
                <a className="text-button" href="/shop">Continue shopping</a>
            </div>
            <aside className="order-summary"><h2>Order Summary</h2>
                <PromoCode disabled={busy || Boolean(store.cartError)} onBusyChange={setPromoBusy}/>
                <div className="summary-lines">
                    <p><span>Subtotal</span><strong>{q ? money(q.subtotal) : 'Unavailable'}</strong></p>
                    {packSavings > 0 && <p><span>Pack savings</span><strong>−{money(packSavings)}</strong></p>}
                    {promoSavings > 0 && <p><span>Promo savings</span><strong>−{money(promoSavings)}</strong></p>}
                    <p><span>Shipping</span><span>{q?.total >= store.config.freeShippingAt ? 'Free' : 'At checkout'}</span></p>
                    <p><span>Tax</span><span>At checkout</span></p>
                    <p className="total"><span>Items total</span><strong>{q ? money(q.total) : 'Unavailable'}</strong></p>
                </div>
                {q?.total < store.config.freeShippingAt && <p className="muted">Add {money(store.config.freeShippingAt - q.total)} for free standard shipping.</p>}
                <a className="button button-gold" href={store.cartError || locked ? undefined : '/checkout'} aria-disabled={Boolean(store.cartError) || locked} onClick={e => { if (store.cartError || locked) e.preventDefault(); }}>Proceed to checkout</a>
                <p className="muted">{store.payment.enabled ? store.payment.state === 'sandbox' ? 'Test checkout only. Real payments are not accepted.' : 'Secure card payment is available at checkout.' : 'Checkout is not accepting payments yet. Your cart stays saved.'}</p>
            </aside>
        </div>}
    </>;
}
export function AddressFields({ initial = {} }: {
    initial?: Record<string, string>;
}) { return <><Field label="Full name" name="name" defaultValue={initial.name}/><Field label="Street address" name="line1" defaultValue={initial.line1}/><Field label="Apartment / suite (optional)" name="line2" defaultValue={initial.line2} required={false}/><div className="form-row"><Field label="City" name="city" defaultValue={initial.city}/><Field label="State (2 letters)" name="state" defaultValue={initial.state} placeholder="CA"/><Field label="ZIP code" name="zip" defaultValue={initial.zip}/></div><Field label="Phone" name="phone" type="tel" defaultValue={initial.phone}/><input type="hidden" name="country" value="US"/><p className="muted">United States delivery only.</p></>; }
export function Checkout() {
    const { store, ready, loadError, refresh } = useStore();
    const { retrying, retryLoad } = useStoreLoadRetry(refresh);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [promoBusy, setPromoBusy] = useState(false);
    const [deliveryQuote, setDeliveryQuote] = useState<{ data: any; context: string } | null>(null);
    const [address, setAddress] = useState<any>(null);
    const [requestKey, setRequestKey] = useState('');
    const operation = useRef(false);
    const promoOperation = useRef(false);
    const quoteRevision = useRef(0);
    const q = store.totals;
    const quoteContext = JSON.stringify([store.cart, store.cartConflict?.id, q?.total, q?.promo?.code || '']);
    const currentContext = useRef(quoteContext);
    currentContext.current = quoteContext;
    const delivery = deliveryQuote?.context === quoteContext ? deliveryQuote.data : null;
    const packSavings = q?.packDiscount ?? q?.discount ?? 0;
    const promoSavings = q?.promoDiscount ?? q?.promo?.savings ?? 0;
    useEffect(() => setRequestKey(crypto.randomUUID()), []);
    function invalidateDelivery() {
        quoteRevision.current += 1;
        setDeliveryQuote(null);
        setAddress(null);
    }
    useEffect(() => { invalidateDelivery(); }, [quoteContext]);
    function changePromoBusy(next: boolean) {
        promoOperation.current = next;
        setPromoBusy(next);
        if (next) invalidateDelivery();
    }
    if (!ready) return <section aria-busy={retrying}>
        <div className="page-heading"><h1>Checkout</h1></div>
        <p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading checkout…'}</p>
        {loadError && <button type="button" className="button button-dark" disabled={retrying} onClick={retryLoad}>{retrying ? 'Retrying…' : 'Retry checkout'}</button>}
    </section>;
    if (store.cartConflict) return <CartChoice/>;
    if (!store.payment.enabled) return <section className="checkout-unavailable"><h1>Checkout is not open yet.</h1><p>Your cart stays saved with your shopping session. We are preparing secure checkout and will accept orders once it is ready.</p><div className="checkout-unavailable-actions"><a className="button button-dark" href="/cart">Return to your cart</a><a href="/shop">Keep shopping</a><a href="/contact">Contact Biomod</a></div></section>;
    if (store.cartError) return <Blank title="Your cart needs a review."><p>{store.cartError}</p><a className="button button-dark" href="/cart">Review your cart</a></Blank>;
    if (!store.customer) return <AuthPage returnTo="/checkout"/>;
    if (!store.cart.length) return <Blank title="Your cart is empty."><a href="/shop">Shop products</a></Blank>;
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (operation.current || promoOperation.current) return;
        operation.current = true;
        setBusy(true);
        invalidateDelivery();
        const revision = quoteRevision.current;
        const context = currentContext.current;
        try {
            const fields = formData(e.currentTarget);
            const data = await api('delivery', { address: fields });
            if (revision !== quoteRevision.current || context !== currentContext.current || promoOperation.current) return;
            setAddress(fields);
            setDeliveryQuote({ data, context });
        } catch (e) {
            if (revision === quoteRevision.current) report(e);
        } finally { operation.current = false; setBusy(false); }
    }
    async function checkout() {
        if (!delivery || !accepted || !requestKey || operation.current || promoOperation.current || !store.payment.enabled) return;
        operation.current = true;
        setBusy(true);
        try {
            const d = await api('checkout', { address, accepted, requestKey, expectedTotal: delivery.total, quoteId: delivery.quoteId });
            location.assign(d.url);
        } catch (e) { report(e); operation.current = false; setBusy(false); }
    }
    return <><div className="page-heading"><h1>Checkout</h1></div>
        {store.payment.state === 'sandbox' && <p className="notice">Test checkout only. This payment environment does not accept real payments.</p>}
        <div className="cart-layout">
            <form className="store-form" onSubmit={submit} onChange={invalidateDelivery}>
                <h2>Delivery address</h2><AddressFields initial={{ name: store.customer.name }}/>
                <button className="button button-dark" disabled={busy || promoBusy}>{busy ? 'Calculating…' : 'Calculate delivery and tax'}</button>
            </form>
            <aside className="order-summary"><h2>Your order</h2>
                {q?.items.map((l: any, i: number) => <p className="summary-product" key={i}><span>{l.product.name} × {l.quantity}</span><strong>{money(l.lineTotal ?? l.product.price * l.quantity)}</strong></p>)}
                <PromoCode disabled={busy} onBusyChange={changePromoBusy} onChange={invalidateDelivery}/>
                <div className="summary-lines">
                    <p><span>Subtotal</span><strong>{q ? money(q.subtotal) : 'Unavailable'}</strong></p>
                    {packSavings > 0 && <p><span>Pack savings</span><strong>−{money(packSavings)}</strong></p>}
                    {promoSavings > 0 && <p><span>Promo savings</span><strong>−{money(promoSavings)}</strong></p>}
                    <p><span>Items total</span><strong>{q ? money(q.total) : 'Unavailable'}</strong></p>
                    <p><span>Shipping</span><strong>{delivery ? money(delivery.shipping) : 'Pending address'}</strong></p>
                    <p><span>Tax</span><strong>{delivery ? money(delivery.tax) : 'Pending address'}</strong></p>
                    {delivery && <p className="total"><span>Total</span><strong>{money(delivery.total)}</strong></p>}
                </div>
                <Check checked={accepted} onChange={setAccepted}>I am 21 or older and purchasing exclusively for laboratory research. I agree to the <a href="/terms-of-sale">terms of sale</a>.</Check>
                <button className="button button-gold" disabled={!delivery || !accepted || !requestKey || busy || promoBusy || !store.payment.enabled} onClick={() => void checkout()}>Continue to secure payment</button>
                <p className="muted">Card information is entered on Authorize.net’s secure payment page.</p>
            </aside>
        </div>
    </>;
}
const accountNav = [['Overview', ''], ['Orders', 'orders'], ['Addresses', 'addresses'], ['Wishlist', 'wishlist'], ['Rewards', 'rewards'], ['Affiliate', 'affiliate'], ['Notifications', 'notifications'], ['Profile', 'profile']];
export function Account({ section = '' }: {
    section?: string;
}) { const { store, ready, refresh, reorder } = useStore(); const [data, setData] = useState<any>(null); const [busy, setBusy] = useState(false); const [accepted, setAccepted] = useState(false); async function load() { const d = await api('account'); setData(d); setAccepted(Boolean(d.profile?.research_accepted)); } useEffect(() => { if (store.customer)
    load().catch(report); }, [store.customer?.id]); async function submit(e: FormEvent<HTMLFormElement>, action: string) { e.preventDefault(); setBusy(true); try {
    const d = await api(action, { ...formData(e.currentTarget), accepted });
    toast.success(d.message);
    await load();
}
catch (e) {
    report(e);
}
finally {
    setBusy(false);
} } if (ready && store.cartConflict && !section) return <CartChoice/>; if (section === 'wishlist')
    return <><div className="page-heading"><h1>Your Wishlist</h1></div>{store.wishlist.length ? <div className="product-grid">{store.products.filter(p => store.wishlist.includes(p.id)).map(p => <ProductCard key={p.id} product={p}/>)}</div> : <Blank title="Your wishlist is empty.">Use the heart on a product to save it here.</Blank>}</>; if (!ready)
    return <p>Loading your account…</p>; if (!store.customer)
    return <AuthPage returnTo={'/account/' + section}/>; return <><div className="page-heading"><h1>My Account</h1></div><div className="account-layout"><aside className="account-nav"><p>{store.customer.email}</p>{accountNav.map(([name, path]) => <a className={section === path ? 'active' : ''} key={path} href={'/account/' + path}>{name}</a>)}{store.admin && <a href="/admin">Store administration</a>}<button onClick={() => api('auth-logout', {}).then(() => location.assign('/login')).catch(report)}>Sign out</button></aside><div className="account-body">{!data ? <p>Loading account details…</p> : section === 'orders' ? <><h2>Orders</h2>{!data.orders.length ? <Blank title="No orders yet."><a href="/shop">Explore the catalog</a></Blank> : data.orders.map((o: any) => <article className="account-record" key={o.id}><h3>Order {o.id.slice(0, 8)}</h3><p>{new Date(o.created).toLocaleDateString()} · {o.status.replaceAll('_', ' ')} · {money(o.total)}</p>{o.data.items?.map((i: any, n: number) => <p key={n}>{i.product.name} × {i.quantity} {!i.unavailable&&<a className="order-document-link" href={'/testing?product='+i.product.id}>Product documentation</a>}</p>)}{!o.data.catalogUnavailable&&['paid','shipped','delivered'].includes(o.status)&&<button className="button button-dark" disabled={busy} onClick={async()=>{setBusy(true);try{await reorder(o.data.items);location.assign('/cart');}catch(e){report(e);}finally{setBusy(false);}}}>{busy?'Adding…':'Reorder at current prices'}</button>}{o.data.catalogUnavailable&&<p className="notice">This order contains an archived product. Contact Biomod for order support.</p>}{o.data.tracking && <p>Tracking: {o.data.tracking}</p>}{!o.data.catalogUnavailable&&['awaiting_payment', 'pending'].includes(o.status) && <button className="button button-dark" onClick={() => api('resume', { id: o.id }).then(d => location.assign(d.url)).catch(report)}>Resume checkout</button>}{!['paid', 'shipped', 'delivered'].includes(o.status) && <button className="button button-dark" onClick={() => api('reconcile', { id: o.id }).then(d => { toast.info(d.message || d.status); load(); }).catch(report)}>Check payment status</button>}</article>)}</> : section === 'addresses' ? <><h2>Saved addresses</h2>{data.addresses.map((a: any) => <article className="account-record" key={a.id}><strong>{a.name}</strong><p>{a.line1} {a.line2}<br />{a.city}, {a.state} {a.zip}</p><button className="text-button" onClick={() => api('address', { id: a.id, remove: true }).then(load).catch(report)}>Remove</button></article>)}<form className="store-form" onSubmit={e => submit(e, 'address')}><h3>Add an address</h3><AddressFields /><button className="button button-dark" disabled={busy}>Save address</button></form></> : section === 'profile' ? <form className="store-form" onSubmit={e => submit(e, 'profile')}><h2>Profile</h2><Field label="Full name" name="name" defaultValue={data.profile?.name || store.customer.name}/><Field label="Phone" name="phone" type="tel" defaultValue={data.profile?.phone}/><Field label="Institution / company" name="company" defaultValue={data.profile?.company}/><Check checked={accepted} onChange={setAccepted}>My purchases are exclusively for laboratory research.</Check><button className="button button-dark" disabled={busy}>Save profile</button></form> : section === 'rewards' ? <><h2>Rewards</h2>{!store.config.rewardsEnabled ? <Blank title="Rewards are not active yet.">Program details will appear here when released.</Blank> : <><p className="reward-total">{data.rewards.reduce((s: number, r: any) => s + r.points, 0)} points</p>{data.rewards.length ? data.rewards.map((r: any, i: number) => <p key={i}>{r.reason}: {r.points} points · {new Date(r.created).toLocaleDateString()}</p>) : <p>No rewards have been earned yet.</p>}</>}</> : section === 'notifications' ? <><h2>Notifications</h2>{data.requests.length ? data.requests.map((r: any) => <article className="account-record" key={r.id}><strong>{r.kind === 'stock' ? 'Restock request' : r.kind === 'affiliate' ? 'Partner application' : 'Support message'}</strong><p>{r.status} · {new Date(r.created).toLocaleDateString()}</p></article>) : <Blank title="No notifications.">Your requests and updates will appear here.</Blank>}</> : section === 'affiliate' ? <><h2>Affiliate program</h2><p>Apply to partner with Biomod. Applications are reviewed before program access is granted.</p><form className="store-form" onSubmit={e => submit(e, 'affiliate')}><Field label="Website or profile URL" name="website" type="url"/><Field label="Tell us about your audience" name="message"><textarea name="message" required rows={5}/></Field><button className="button button-dark" disabled={busy}>Submit application</button></form></> : <><h2>Welcome{store.customer.name ? ', ' + store.customer.name : ''}.</h2><p>Manage your orders, addresses, saved products, and research account.</p><div className="account-overview"><a href="/account/orders"><strong>{data.orders.length}</strong>Orders</a><a href="/account/wishlist"><strong>{store.wishlist.length}</strong>Saved products</a><a href="/account/addresses"><strong>{data.addresses.length}</strong>Addresses</a></div></>}</div></div></>; }
export function PaymentReturn() { const { store } = useStore(); const [orders, setOrders] = useState<any[]>([]); useEffect(() => { if (store.customer)
    api('account').then(d => setOrders(d.orders)).catch(report); }, [store.customer?.id]); return <><h1>Payment status</h1><p>Returning from the payment page does not by itself confirm a payment. Open your order to verify its status.</p>{orders.filter(o => !['paid', 'shipped', 'delivered'].includes(o.status)).map(o => <article className="account-record" key={o.id}><h2>Order {o.id.slice(0, 8)}</h2><p>{money(o.total)} · {o.status}</p><button className="button button-dark" onClick={() => api('reconcile', { id: o.id }).then(d => toast.info(d.message || d.status)).catch(report)}>Verify payment</button></article>)}<a href="/account/orders">View my orders</a></>; }
