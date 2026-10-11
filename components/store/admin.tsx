'use client';
import { TrafficDiagnostics } from './traffic-diagnostics';
import { PromoAnalytics } from './promo-analytics';
import { CoaAutomation } from './coa-automation';
import { supportsPacks } from '@/lib/packs';
import { SearchPublishing } from './seo-admin';
import { SalesDiagnostics } from './sales-diagnostics';
import { Fragment, useEffect, useRef, useState, FormEvent } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useStore, api, report } from './provider';
import { AuthPage } from './account';
import { Field, Choice, Check, Blank, formData } from './primitives';
import { money } from '@/lib/catalog';
import { toast } from 'sonner';
import { ShippingLabel } from './shipping-admin';
import { OrderDetails } from './order-admin';
function localDate(value?: string) { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); }
const adminTabs = [
    ['orders', 'Orders'], ['promos', 'Affiliate & promo codes'], ['settings', 'Settings'],
    ['products', 'Products'], ['presales', 'Presales'], ['requests', 'Requests'],
    ['rewards', 'Rewards'], ['search', 'Search'], ['diagnostics', 'Diagnostics'], ['traffic', 'Traffic'],
] as const;
function validAdminTab(value?: string) { return adminTabs.some(([tab]) => tab === value) ? value! : 'orders'; }
export function Admin({ initialTab = 'orders' }: { initialTab?: string } = {}) {
    type Scope = { owner: string | null; tenure: number; lifetime: number; active: boolean };
    type Operation = { scope: Scope; lifetime: number };
    type View = Operation & { data: any; error: string; loading: boolean; loadedAt: number | null };
    const { store, ready, loadError, refresh } = useStore();
    const owner = ready && store.admin ? store.customer?.id || null : null;
    const scopeRef = useRef<Scope>({ owner, tenure: 0, lifetime: 0, active: false });
    if (scopeRef.current.owner !== owner) scopeRef.current = { owner, tenure: scopeRef.current.tenure + 1, lifetime: 0, active: false };
    const scope = scopeRef.current;
    const renderedLifetime = scope.lifetime;
    const requestedTab = validAdminTab(initialTab);
    const [selectedTab, setSelectedTab] = useState(requestedTab);
    const [view, setView] = useState<View>({ scope, lifetime: 0, data: null, error: '', loading: false, loadedAt: null });
    const [edited, setEditedState] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [q, setQState] = useState('');
    const [flags, setFlagsState] = useState({ presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false });
    const [retryingAccess, setRetryingAccess] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [formGeneration, setFormGeneration] = useState(0);
    const formGenerationRef = useRef(0);
    const drafts = useRef({ revision: 0, forms: new Map<string, number>() });
    const readOperation = useRef<Operation | null>(null);
    const actionOperation = useRef<Operation | null>(null);
    const accessOperation = useRef<Operation | null>(null);
    const current = (request: Operation) => request.scope === scopeRef.current && request.scope.active && request.lifetime === request.scope.lifetime;
    const renderOperation = { scope, lifetime: renderedLifetime };
    const currentForm = () => current(renderOperation) && formGeneration === formGenerationRef.current;
    const shown = view.scope === scope && view.lifetime === scope.lifetime ? view : { data: null, error: '', loading: true, loadedAt: null };
    const data = shown.data;
    const pausedRead = 'Refresh paused to protect unsaved edits. Save or discard your edits, then refresh administration.';
    function remountCleanForms() { formGenerationRef.current += 1; setFormGeneration(formGenerationRef.current); }
    function markDraft(key: string) {
        if (!currentForm()) return;
        drafts.current.revision += 1;
        drafts.current.forms.set(key, drafts.current.revision);
        setDirty(true);
    }
    function clearDraft(key: string) {
        drafts.current.revision += 1;
        drafts.current.forms.delete(key);
        setDirty(drafts.current.forms.size > 0);
    }
    function setEdited(value: any) {
        if (!currentForm()) return;
        if (value) markDraft('product'); else clearDraft('product');
        setEditedState(value);
    }
    function setQ(value: string) { if (current(renderOperation)) setQState(value); }
    function setFlags(value: typeof flags) { if (currentForm()) { markDraft('config'); setFlagsState(value); } }
    function selectTab(value: string) {
        if (current(renderOperation) && !drafts.current.forms.size && !actionOperation.current) setSelectedTab(validAdminTab(value));
    }
    function discardDrafts() {
        if (!currentForm() || actionOperation.current) return;
        drafts.current.revision += 1;
        drafts.current.forms.clear();
        setDirty(false); setEditedState(null);
        setFlagsState({ presalesEnabled: Boolean(data.config.presalesEnabled), rewardsEnabled: Boolean(data.config.rewardsEnabled), affiliateEnabled: Boolean(data.config.affiliateEnabled) });
        remountCleanForms();
    }
    async function load(request: Operation) {
        if (!owner || !current(request)) return;
        if (drafts.current.forms.size) {
            setView(previous => ({ ...previous, error: pausedRead }));
            return;
        }
        // A successful action may supersede an older read. Edits made while a
        // clean read is in flight also invalidate it, preserving all form values.
        const read = { ...request };
        const draftRevision = drafts.current.revision;
        readOperation.current = read;
        setView(previous => ({ ...previous, loading: true }));
        try {
            const result = await api('admin');
            if (!['products', 'campaigns', 'orders', 'requests'].every(key => Array.isArray(result?.[key])) ||
                !result?.config || typeof result.config !== 'object' ||
                !result.config.packDiscounts || typeof result.config.packDiscounts !== 'object' ||
                !Number.isFinite(result.config.freeShippingAt)) throw new Error('Admin details unavailable');
            if (!current(read) || readOperation.current !== read) return;
            if (draftRevision !== drafts.current.revision || drafts.current.forms.size) {
                setView(previous => ({ ...previous, error: pausedRead }));
                return;
            }
            setView({ ...request, data: result, error: '', loading: false, loadedAt: Date.now() });
            setFlagsState({ presalesEnabled: Boolean(result.config.presalesEnabled), rewardsEnabled: Boolean(result.config.rewardsEnabled), affiliateEnabled: Boolean(result.config.affiliateEnabled) });
            // Uncontrolled inputs and controlled program flags now share the
            // same accepted snapshot. Never remount on errors or while dirty.
            remountCleanForms();
        } catch {
            if (current(read) && readOperation.current === read) setView(previous => ({ ...previous, error: previous.data
                ? 'Store administration could not refresh. Your last loaded information is still shown. Retry to check the latest details.'
                : 'Store administration could not load. Please retry.' }));
        } finally {
            if (readOperation.current === read) {
                readOperation.current = null;
                if (current(read)) setView(previous => ({ ...previous, loading: false }));
            }
        }
    }
    function retryDetails() {
        if (!current(renderOperation) || readOperation.current || actionOperation.current || drafts.current.forms.size) return;
        void load(renderOperation);
    }
    async function retryAccess() {
        if (!current(renderOperation) || accessOperation.current) return;
        const request = renderOperation;
        accessOperation.current = request;
        setRetryingAccess(true);
        try { await refresh(); }
        catch (error) { if (current(request)) report(error); }
        finally {
            if (accessOperation.current === request) accessOperation.current = null;
            if (current(request)) setRetryingAccess(false);
        }
    }
    useEffect(() => {
        scope.active = true;
        scope.lifetime += 1;
        readOperation.current = null;
        actionOperation.current = null;
        accessOperation.current = null;
        drafts.current = { revision: 0, forms: new Map() };
        setView({ scope, lifetime: scope.lifetime, data: null, error: '', loading: Boolean(owner), loadedAt: null });
        setEditedState(null); setQState(''); setBusy(false); setRetryingAccess(false); setDirty(false);
        setSelectedTab(requestedTab);
        setFlagsState({ presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false });
        if (owner) void load({ scope, lifetime: scope.lifetime });
        return () => { scope.active = false; scope.lifetime += 1; };
    }, [scope]);
    useEffect(() => {
        if (!drafts.current.forms.size && !actionOperation.current) setSelectedTab(requestedTab);
    }, [requestedTab]);
    async function change(action: string, body: any, onSaved?: (result: any) => void, refreshStore = false) {
        if (!owner || !currentForm() || actionOperation.current) return;
        const request = renderOperation;
        actionOperation.current = request;
        // An earlier read must not refresh fields during a save.
        drafts.current.revision += 1;
        setBusy(true);
        try {
            const result = await api('admin-' + action, body);
            if (!current(request)) return;
            onSaved?.(result);
            await load(request);
            if (refreshStore && current(request)) await refresh();
        } catch (error) {
            if (current(request)) report(error);
        } finally {
            if (actionOperation.current === request) actionOperation.current = null;
            if (current(request)) setBusy(false);
        }
    }
    async function submit(e: FormEvent<HTMLFormElement>, action: string, transform: (d: any) => any = d => d, draftKey = action) {
        e.preventDefault();
        if (!currentForm() || actionOperation.current) return;
        const submittedRevision = drafts.current.forms.get(draftKey);
        try {
            await change(action, transform(formData(e.currentTarget)), result => {
                toast.success(result.message || 'Saved');
                // Keep any edits made after submitting, and drafts in other forms.
                if (drafts.current.forms.get(draftKey) === submittedRevision) {
                    clearDraft(draftKey);
                    if (action === 'product') setEditedState(null);
                }
            }, true);
        } catch (error) { if (current(renderOperation)) report(error); }
    }
    const accessFailure = loadError ? <div className="notice error"><p role="alert">{ready ? 'Administrator access could not refresh. The last loaded information is still shown.' : 'Administrator access could not load. Please retry.'}</p><button type="button" className="button button-dark" disabled={retryingAccess} onClick={retryAccess}>{retryingAccess ? 'Retrying access…' : 'Retry administrator access'}</button></div> : null;
    const readFailure = shown.error ? <div className="notice error"><p role="alert">{shown.error}</p><button type="button" className="button button-dark" disabled={shown.loading || busy || dirty} onClick={retryDetails}>{shown.loading ? 'Refreshing administration…' : 'Retry administration'}</button></div> : null;
    if (!ready) return <section aria-busy={retryingAccess}><h1>Store Administration</h1>{accessFailure || <p role="status">Loading administrator access…</p>}</section>;
    if (!store.customer) return <AuthPage returnTo={'/admin?tab=' + selectedTab}/>;
    if (!store.admin) return <Blank title="Administrator access required.">Sign in with an authorized Biomod administrator account.</Blank>;
    if (!data) return <section aria-busy={shown.loading}><h1>Store Administration</h1>{accessFailure}{readFailure || <p role="status">Loading store administration…</p>}</section>;
    return <Fragment key={scope.tenure + ':' + scope.lifetime}><div className="page-heading"><h1>Store Administration</h1><p>Manage your custom Biomod storefront.</p></div>{accessFailure}{readFailure}
<div className="catalog-toolbar"><button type="button" className="button button-dark" disabled={shown.loading || busy || dirty} onClick={retryDetails}>{shown.loading ? 'Refreshing administration…' : 'Refresh administration'}</button>{shown.loadedAt && <p>Administration loaded at <time dateTime={new Date(shown.loadedAt).toISOString()}>{new Date(shown.loadedAt).toLocaleTimeString()}</time>.</p>}</div>
{dirty && <div className="notice"><p role="status">Save or discard unsaved edits before refreshing or switching tabs. Close the product editor to discard its draft.</p><button type="button" className="text-button" disabled={busy} onClick={discardDrafts}>Discard unsaved edits</button></div>}
<Tabs value={selectedTab} onValueChange={selectTab}><TabsList className="admin-tabs">{adminTabs.map(([value, label]) => <TabsTrigger key={value} value={value} disabled={value !== selectedTab && (dirty || busy)}>{label}</TabsTrigger>)}</TabsList><TabsContent value="settings"><form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('config')} onSubmit={e => submit(e, 'config', d => ({ ...flags, packDiscounts: Object.fromEntries([3, 5, 10].map(n => [n, d['pack' + n] === '' ? null : Number(d['pack' + n])])), shippingCents: d.shipping === '' ? null : Math.round(Number(d.shipping) * 100), freeShippingAt: Math.round(Number(d.threshold) * 100) }))}><h2>Mix-and-match discounts</h2><p>Single vials and bottles use the product price. These discounts apply to mixed packs. Edit fixed-pack totals under Products.</p><div className="form-row">{[3, 5, 10].map(n => <Field key={n} label={n + '-item discount (%)'} name={'pack' + n} type="number" required={false} defaultValue={data.config.packDiscounts[n]?.toString() || ''}/>)}</div><h2>Shipping</h2><div className="form-row"><Field label="Standard shipping ($)" name="shipping" type="number" required={false} defaultValue={data.config.shippingCents == null ? '' : String(data.config.shippingCents / 100)}/><Field label="Free shipping threshold ($)" name="threshold" type="number" defaultValue={String(data.config.freeShippingAt / 100)}/></div><h2>Programs</h2><Check checked={flags.presalesEnabled} onChange={v => setFlags({ ...flags, presalesEnabled: v })}>Enable presales</Check><Check checked={flags.rewardsEnabled} onChange={v => setFlags({ ...flags, rewardsEnabled: v })}>Enable rewards</Check><Check checked={flags.affiliateEnabled} onChange={v => setFlags({ ...flags, affiliateEnabled: v })}>Enable affiliate program</Check><button className="button button-dark" disabled={busy}>Save store settings</button></form><p className="notice">Payment status: {store.payment.state.replaceAll('_', ' ')}. Merchant credentials and account-provider settings are configured securely on the server.</p></TabsContent><TabsContent value="products"><div className="catalog-toolbar"><h2>Products</h2><input aria-label="Find a product to edit" placeholder="Find a product" value={q} onChange={e => setQ(e.target.value)}/></div><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Price</TableHead><TableHead>Verified stock</TableHead><TableHead>Availability</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{data.products.filter((p: any) => p.name.toLowerCase().includes(q.toLowerCase())).map((p: any) => <TableRow key={p.id}><TableCell>{p.name}</TableCell><TableCell>{money(p.price)}</TableCell><TableCell>{p.stockQuantity ?? 'Not set'}</TableCell><TableCell>{p.inStock ? 'In stock' : 'Out of stock'}</TableCell><TableCell><button className="text-button" onClick={() => setEdited(p)}>Edit</button></TableCell></TableRow>)}</TableBody></Table></TabsContent><TabsContent value="presales"><h2>Presale campaigns</h2>{data.campaigns.map((c: any) => <article className="account-record" key={c.id}><h3>{c.title}</h3><p>{c.active ? 'Enabled' : 'Disabled'} · {c.starts} to {c.ends}</p><button className="text-button" disabled={busy} onClick={() => change('campaign', { ...c, active: !c.active })}>{c.active ? 'Disable' : 'Enable'}</button></article>)}<form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('campaign')} onSubmit={e => submit(e, 'campaign', d => ({ ...d, starts: new Date(d.starts).toISOString(), ends: new Date(d.ends).toISOString(), maxPerCustomer: Number(d.maxPerCustomer), productIds: d.productIds.split(',').map((s: string) => Number(s.trim())), active: false }))}><h3>Create a presale</h3><Field label="Campaign title" name="title"/><div className="form-row"><Field label="Opens" name="starts" type="datetime-local"/><Field label="Closes" name="ends" type="datetime-local"/></div><Field label="Expected shipping" name="ships"/><Field label="Product IDs, separated by commas" name="productIds"/><Field label="Maximum units per customer" name="maxPerCustomer" type="number"/><button className="button button-dark" disabled={busy}>Save disabled campaign</button></form></TabsContent><TabsContent value="orders"><h2>Orders</h2>{!data.orders.length ? <Blank title="No orders received."/> : data.orders.map((o: any) => <article className="account-record" key={o.id}><h3>{o.id.slice(0, 8)} · {money(o.total)}</h3><p>{o.status} · {new Date(o.created).toLocaleString()}</p><OrderDetails order={o}/>{!['paid', 'shipped', 'delivered'].includes(o.status) && <button className="text-button" disabled={busy} onClick={() => change('reconcile', { id: o.id }, d => toast.info(d.message || d.status))}>Reconcile payment</button>}<ShippingLabel order={o} onDone={() => load(renderOperation)}/>{['paid', 'shipped'].includes(o.status) && <form key={formGeneration} className="form-row" onChangeCapture={() => markDraft('order:' + o.id)} onSubmit={e => submit(e, 'order', d => ({ ...d, id: o.id }), 'order:' + o.id)}><Field label="Tracking number / carrier" name="tracking" defaultValue={o.data.tracking}/><Field label="Fulfillment status" name="status"><select name="status"><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></Field><button className="button button-dark">Update fulfillment</button></form>}</article>)}</TabsContent><TabsContent value="requests"><CoaAutomation key={'coa:' + formGeneration} report={data.coaAutomation} requests={data.requests} busy={busy} dirty={dirty} refreshing={shown.loading} onDraft={() => markDraft('coa-config')} onSave={e => submit(e, 'coa-config', d => ({ enabled: d.enabled === 'on', replyTo: d.replyTo, notifyTo: d.notifyTo || null }))} onProcess={async id => { if (drafts.current.forms.size || readOperation.current) return; await change('coa-process', { id }, result => toast.info(result.message || 'COA request processed. Check its outbox status.')); }}/><h2>Customer requests</h2>{!data.requests.length ? <Blank title="No customer requests."/> : data.requests.map((r: any) => <article className="account-record" key={r.id}><h3>{r.kind} · {r.status}</h3><p>{new Date(r.created).toLocaleString()}</p>{Object.entries(r.data).map(([k, v]) => <p key={k}><strong>{k}: </strong>{String(v)}</p>)}<Choice label="Request status" value={r.status} onChange={status => change('request', { id: r.id, status })} options={[["new", "New"], ["reviewed", "Reviewed"], ["resolved", "Resolved"]]}/></article>)}</TabsContent><TabsContent value="rewards"><form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('reward')} onSubmit={e => submit(e, 'reward', d => ({ ...d, points: Number(d.points) }))}><h2>Reward ledger</h2><p>Record an earned reward or adjustment for an existing customer.</p><Field label="Customer ID" name="owner"/><Field label="Points (negative for an adjustment)" name="points" type="number"/><Field label="Reason" name="reason"/><button className="button button-dark" disabled={busy}>Save reward entry</button></form></TabsContent><TabsContent value="search"><SearchPublishing report={data.searchPublishing}/></TabsContent><TabsContent value="diagnostics"><SalesDiagnostics/></TabsContent><TabsContent value="traffic"><TrafficDiagnostics/></TabsContent><TabsContent value="promos"><PromoAnalytics/></TabsContent></Tabs><Dialog open={Boolean(edited)} onOpenChange={v => { if (!v)
    setEdited(null); }}><DialogContent className="product-edit-dialog"><DialogTitle>Edit {edited?.name}</DialogTitle><DialogDescription>Prices and stock are checked again when the customer orders.</DialogDescription>{edited && <form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('product')} onSubmit={e => submit(e, 'product', d => ({ id: edited.id, expectedStock: edited.stockQuantity??null, sale: d.salePercent ? { enabled: Boolean(edited.sale?.enabled), percentOff: Number(d.salePercent), starts: new Date(d.saleStarts).toISOString(), ends: new Date(d.saleEnds).toISOString() } : null, price: Math.round(Number(d.price) * 100), ...(supportsPacks(edited) ? { packPrices: Object.fromEntries([3,5,10].map(n => [n, d['fixed' + n] === '' ? null : Math.round(Number(d['fixed' + n]) * 100)])) } : {}), stockQuantity: d.stockQuantity === '' ? null : Number(d.stockQuantity), maxQuantity: Number(d.maxQuantity), inStock: edited.inStock, purchasable: edited.purchasable }))}><Field label="Price ($)" name="price" type="number" step="0.01" defaultValue={String(edited.price / 100)}/>{supportsPacks(edited) && <><h3>Fixed-pack totals</h3><p>Price for the whole pack. Leave blank to use the standard bulk discount.</p><div className="form-row">{[3,5,10].map(n => <Field key={n} label={n + '-pack ($)'} name={'fixed' + n} type="number" step="0.01" required={false} defaultValue={edited.packPrices?.[n] != null ? String(edited.packPrices[n] / 100) : ''}/>)}</div></>}<h3>Scheduled sale</h3><p>Set your own percentage and dates. The sale applies to the single price and fixed-pack totals; mixed-pack savings also apply to sale prices. Dates use your device’s time zone.</p><Check checked={Boolean(edited.sale?.enabled)} onChange={v => setEdited({ ...edited, sale: { ...edited.sale, enabled: v } })}>Enable scheduled sale</Check><Field label="Sale discount (%)" name="salePercent" type="number" step="0.01" required={Boolean(edited.sale?.enabled)} defaultValue={edited.sale?.percentOff?.toString() || ''}/><div className="form-row"><Field label="Sale starts" name="saleStarts" type="datetime-local" required={Boolean(edited.sale?.enabled)} defaultValue={localDate(edited.sale?.starts)}/><Field label="Sale ends" name="saleEnds" type="datetime-local" required={Boolean(edited.sale?.enabled)} defaultValue={localDate(edited.sale?.ends)}/></div><p>Leave the discount blank to remove the sale. Scheduled offers start and end automatically.</p><Field label="Verified inventory quantity" name="stockQuantity" type="number" required={false} defaultValue={edited.stockQuantity?.toString() || ''}/><Field label="Maximum per order" name="maxQuantity" type="number" defaultValue={String(edited.maxQuantity || 100)}/><Check checked={edited.inStock} onChange={v => setEdited({ ...edited, inStock: v })}>In stock</Check><Check checked={edited.purchasable} onChange={v => setEdited({ ...edited, purchasable: v })}>Available for purchase</Check><button className="button button-dark" disabled={busy}>Save product</button></form>}</DialogContent></Dialog></Fragment>; }
