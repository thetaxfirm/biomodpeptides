'use client';
import { TrafficDiagnostics } from './traffic-diagnostics';
import { ChangeHistory } from './change-history';
import { AdminProducts } from './admin-products';
import { AdminShippingSettings } from './admin-shipping-settings';
import { PromoAnalytics } from './promo-analytics';
import { CoaAutomation } from './coa-automation';
import { RequestInbox, type PrepareReplyInput, type ReplySummary, type DeskOptions, type RequestForward, type CaseEntry } from './request-inbox';
import type { RequestIssue } from '@/lib/request-issues';
import { supportsPacks } from '@/lib/packs';
import { SearchPublishing } from './seo-admin';
import { SalesDiagnostics } from './sales-diagnostics';
import { Fragment, useEffect, useRef, useState, FormEvent } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useStore, api, report } from './provider';
import { AuthPage } from './account';
import { Field, Choice, Check, Blank, formData } from './primitives';
import { money } from '@/lib/catalog';
import { toast } from 'sonner';
import { OrdersAdmin } from './orders-admin';
import { TeamAdmin } from './team-admin';
import { permissionsFor, roleDetails, isStaffRole, tabPermission, type StaffRole } from '@/lib/staff';
const adminTabs = [
    ['orders', 'Orders'], ['promos', 'Affiliate & promo codes'], ['settings', 'Settings'],
    ['products', 'Products'], ['presales', 'Presales'], ['requests', 'Requests'],
    ['rewards', 'Rewards'], ['search', 'Search'], ['diagnostics', 'Diagnostics'], ['traffic', 'Traffic'], ['changes', 'Changes'], ['team', 'Team'],
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
    // Stable reply-desk reads: live reply status, picker options and reply rules. Never send.
    const deskApi = useRef({
        refresh: async (ids: string[]) => { const result = await api('admin-request-replies', { ids }); return { replies: result.replies as Record<string, ReplySummary>, forwards: result.forwards as Record<string, RequestForward[]>, activity: result.activity as Record<string, { at: number; text: string }[]> }; },
        forward: async (input: { id: string; to: string; note: string }) => (await api('admin-request-forward', input)).forward as RequestForward,
        issue: async (input: { id: string; issue: string; resolutions: string[]; note: string }) => (await api('admin-request-issue', input)).issue as RequestIssue,
        cases: async () => (await api('admin-case-log', {})).cases as CaseEntry[],
        options: async () => await api('admin-reply-desk', {}) as DeskOptions,
        rule: async (input: { rule?: string; removeId?: string }) => await api('admin-reply-rule', input) as DeskOptions,
    }).current;
    // Counts accepted snapshots so the order queue reloads after every refresh or saved action.
    const loadCount = useRef(0);
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
        if (current(renderOperation) && !drafts.current.forms.size && !actionOperation.current) {
            const tab = validAdminTab(value);
            setSelectedTab(tab);
            if (typeof window !== 'undefined') {
                const url = new URL(window.location.href);
                url.searchParams.set('tab', tab);
                window.history.replaceState(null, '', url.pathname + url.search + url.hash);
            }
        }
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
            loadCount.current += 1;
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
    const [focusRequest, setFocusRequest] = useState<string | null>(null);
    // Orders → Email customer: open (or reuse) that order's conversation in the reply desk.
    async function emailCustomer(orderId: string) {
        let requestId: string | null = null;
        await change('order-conversation', { orderId }, result => { requestId = result.requestId; toast.success(result.message || 'Conversation opened.'); });
        if (requestId) { setFocusRequest(requestId + '|' + Date.now()); selectTab('requests'); }
    }
    async function reportProblem(orderId: string, problem: { issue: string; note: string }) {
        let requestId: string | null = null;
        await change('order-hold', { orderId, issue: problem.issue, note: problem.note }, result => { requestId = result.requestId; toast.success(result.message || 'Order on hold.'); });
        if (requestId) { setFocusRequest(requestId + '|' + Date.now()); selectTab('requests'); }
    }
    async function prepareReply(input: PrepareReplyInput): Promise<ReplySummary> {
        if (!owner || !currentForm() || actionOperation.current || drafts.current.forms.size || readOperation.current) throw new Error('Save other edits or finish refreshing before preparing a reply.');
        const request = renderOperation;
        actionOperation.current = request;
        drafts.current.revision += 1;
        setBusy(true);
        try {
            const result = await api('admin-request-reply', input);
            if (!current(request)) throw new Error('Your admin session changed. Sign in again before reviewing this reply.');
            if (!result.reply) throw new Error('The reply status is unavailable. Refresh administration before trying again.');
            // The desk follows reply status on its own, so no full administration reload here.
            return result.reply;
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
    if (!ready) return <section aria-busy={retryingAccess}><h1>TryBiomod Administration</h1>{accessFailure || <p role="status">Loading administrator access…</p>}</section>;
    if (!store.customer) return <AuthPage returnTo={'/admin?tab=' + selectedTab}/>;
    if (!store.admin) return <Blank title="Administrator access required.">Sign in with an authorized Biomod administrator account.</Blank>;
    if (!data) return <section aria-busy={shown.loading}><h1>TryBiomod Administration</h1>{accessFailure}{readFailure || <p role="status">Loading store administration…</p>}</section>;
    // The server decides access; this only hides what the role cannot use. A response from
    // before staff roles carried no permissions and meant full (manager) access.
    const role: StaffRole | null = isStaffRole(data.role) ? data.role : null;
    const permissions: string[] = Array.isArray(data.permissions) ? data.permissions : permissionsFor('manager');
    const allowed = (permission: string) => permissions.includes(permission);
    const visibleTabs = adminTabs.filter(([tab]) => allowed(tabPermission[tab]));
    const activeTab = visibleTabs.some(([tab]) => tab === selectedTab) ? selectedTab : 'orders';
    return <Fragment key={scope.tenure + ':' + scope.lifetime}><div className="page-heading"><h1>TryBiomod Administration</h1><p>Shared store dashboard for trybiomod.com. Signed in as {store.customer.email}{role ? ' (' + roleDetails[role].label + ')' : ''}.</p></div>{accessFailure}{readFailure}
<div className="catalog-toolbar"><button type="button" className="button button-dark" disabled={shown.loading || busy || dirty} onClick={retryDetails}>{shown.loading ? 'Refreshing administration…' : 'Refresh administration'}</button>{shown.loadedAt && <p>Administration loaded at <time dateTime={new Date(shown.loadedAt).toISOString()}>{new Date(shown.loadedAt).toLocaleTimeString()}</time>.</p>}</div>
{dirty && <div className="notice"><p role="status">Save or discard unsaved edits before refreshing or switching tabs. Use Discard product draft to close the product editor without saving.</p><button type="button" className="text-button" disabled={busy} onClick={discardDrafts}>Discard unsaved edits</button></div>}
<Tabs value={activeTab} onValueChange={selectTab}><TabsList className="admin-tabs">{visibleTabs.map(([value, label]) => <TabsTrigger key={value} value={value} disabled={value !== selectedTab && (dirty || busy)}>{label}</TabsTrigger>)}</TabsList><TabsContent value="settings"><form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('config')} onSubmit={e => submit(e, 'config', d => ({ ...flags, packDiscounts: Object.fromEntries([3, 5, 10].map(n => [n, d['pack' + n] === '' ? null : Number(d['pack' + n])]))}))}><h2>Mix-and-match discounts</h2><p>Single vials and bottles use the product price. These discounts apply to mixed packs. Edit fixed-pack totals under Products.</p><div className="form-row">{[3, 5, 10].map(n => <Field key={n} label={n + '-item discount (%)'} name={'pack' + n} type="number" required={false} defaultValue={data.config.packDiscounts[n]?.toString() || ''}/>)}</div><h2>Programs</h2><Check checked={flags.presalesEnabled} onChange={v => setFlags({ ...flags, presalesEnabled: v })}>Enable presales</Check><Check checked={flags.rewardsEnabled} onChange={v => setFlags({ ...flags, rewardsEnabled: v })}>Enable rewards</Check><Check checked={flags.affiliateEnabled} onChange={v => setFlags({ ...flags, affiliateEnabled: v })}>Enable affiliate program</Check><button className="button button-dark" disabled={busy}>Save store settings</button></form>{allowed('store:write') && <AdminShippingSettings key={'shipping:' + formGeneration} config={data.config} busy={busy}/>}<p className="notice">Payment status: {store.payment.state.replaceAll('_', ' ')}. Merchant credentials and account-provider settings are configured securely on the server.</p></TabsContent><TabsContent value="products">{allowed('store:write') && <AdminProducts batchRecords={data.batchRecords || []} canRelease={data.role === 'owner'} products={data.products} edited={edited} query={q} busy={busy} formKey={formGeneration} onQuery={setQ} onEdit={setEdited} onCancel={() => setEdited(null)} onDraft={() => markDraft('product')} onSave={e => submit(e, 'product', d => ({ id: edited.id, expectedVersion: edited.editVersion, ...(d.batchChanged === 'true' ? { expectedBatch: (() => { const r = data.batchRecords?.find((record: any) => record.productId === edited.id); return r ? { lot: r.lot, reportRef: r.reportRef, coaAvailable: r.coaAvailable } : null; })(), batch: { lot: d.batchLot.trim() || null, reportRef: d.batchReportRef || null, coaAvailable: d.batchCoaAvailable === 'on' } } : {}), releaseReviewed: d.releaseReviewed === 'on', releaseReason: d.releaseReason || '', expectedStock: edited.stockQuantity ?? null, ...(edited.availability ? { availability: edited.availability } : {}), preorder: edited.preorder ? { enabled: Boolean(edited.preorder.enabled), percentOff: Number(d.preorderPercent), ships: d.preorderShips } : null, sale: d.salePercent ? { enabled: Boolean(edited.sale?.enabled), percentOff: Number(d.salePercent), starts: new Date(d.saleStarts).toISOString(), ends: new Date(d.saleEnds).toISOString() } : null, price: Math.round(Number(d.price) * 100), ...(supportsPacks(edited) ? { packPricingMode: d.packPricingMode || undefined, packPrices: Object.fromEntries([3,5,10].map(n => [n, d['fixed' + n] === '' ? null : Math.round(Number(d['fixed' + n]) * 100)])) } : {}), stockQuantity: d.stockQuantity === '' ? null : Number(d.stockQuantity), maxQuantity: Number(d.maxQuantity), inStock: edited.inStock, purchasable: edited.purchasable }))}/>}</TabsContent><TabsContent value="presales"><h2>Presale campaigns</h2>{data.campaigns.map((c: any) => <article className="account-record" key={c.id}><h3>{c.title}</h3><p>{c.active ? 'Enabled' : 'Disabled'} · {c.starts} to {c.ends}</p><button className="text-button" disabled={busy} onClick={() => change('campaign', { ...c, active: !c.active })}>{c.active ? 'Disable' : 'Enable'}</button></article>)}<form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('campaign')} onSubmit={e => submit(e, 'campaign', d => ({ ...d, starts: new Date(d.starts).toISOString(), ends: new Date(d.ends).toISOString(), maxPerCustomer: Number(d.maxPerCustomer), productIds: d.productIds.split(',').map((s: string) => Number(s.trim())), active: false }))}><h3>Create a presale</h3><Field label="Campaign title" name="title"/><div className="form-row"><Field label="Opens" name="starts" type="datetime-local"/><Field label="Closes" name="ends" type="datetime-local"/></div><Field label="Expected shipping" name="ships"/><Field label="Product IDs, separated by commas" name="productIds"/><Field label="Maximum units per customer" name="maxPerCustomer" type="number"/><button className="button button-dark" disabled={busy}>Save disabled campaign</button></form></TabsContent><TabsContent value="orders"><OrdersAdmin reloadToken={loadCount.current} checkoutRecovery={data.checkoutRecovery} allowed={allowed} busy={busy} formGeneration={formGeneration} change={(action, body, onSaved) => change(action, body, onSaved)} submit={submit} markDraft={markDraft} reload={() => load(renderOperation)} onEmailCustomer={allowed('requests:write') ? order => void emailCustomer(order.id) : undefined} onReportProblem={allowed('requests:write') ? (order, problem) => reportProblem(order.id, problem) : undefined} onClearHold={allowed('requests:write') ? order => change('order-hold', { orderId: order.id, clear: true }, result => toast.success(result.message || 'Hold cleared.')) : undefined}/></TabsContent>{allowed('requests:write') && <TabsContent value="requests" forceMount hidden={activeTab !== 'requests'}><RequestInbox requests={data.requests} requestReplies={data.requestReplies || {}} onPrepareReply={prepareReply} canSend={role === 'owner'} onRefreshReplies={deskApi.refresh} onLoadOptions={deskApi.options} onSaveRule={deskApi.rule} onForward={deskApi.forward} onSaveIssue={deskApi.issue} onLoadCases={deskApi.cases} focusId={focusRequest} automation={data.coaAutomation} busy={busy} dirty={dirty} refreshing={shown.loading} onStatus={async (request, status) => { if (drafts.current.forms.size || readOperation.current) return; await change('request', { id: request.id, status, expectedStatus: request.status }, result => toast.success(result.message || 'Request status updated.')); }}/>{allowed('store:write') && <details className="account-record"><summary style={{ cursor: 'pointer', padding: '12px 0', fontWeight: 600 }}>Request alerts and previous COA activity</summary><CoaAutomation key={'coa:' + formGeneration} report={data.coaAutomation} requests={data.requests} busy={busy} dirty={dirty} refreshing={shown.loading} onDraft={() => markDraft('coa-config')} onSave={e => submit(e, 'coa-config', d => ({ enabled: d.enabled === 'on', replyTo: d.replyTo, notifyTo: d.notifyTo || null }))} onProcess={async id => { if (drafts.current.forms.size || readOperation.current) return; await change('coa-process', { id }, result => toast.info(result.message || 'COA request processed. Check its outbox status.')); }}/></details>}</TabsContent>}<TabsContent value="rewards"><form key={formGeneration} className="store-form" onChangeCapture={() => markDraft('reward')} onSubmit={e => submit(e, 'reward', d => ({ ...d, points: Number(d.points) }))}><h2>Reward ledger</h2><p>Record an earned reward or adjustment for an existing customer.</p><Field label="Customer ID" name="owner"/><Field label="Points (negative for an adjustment)" name="points" type="number"/><Field label="Reason" name="reason"/><button className="button button-dark" disabled={busy}>Save reward entry</button></form></TabsContent><TabsContent value="search"><SearchPublishing report={data.searchPublishing}/></TabsContent><TabsContent value="diagnostics"><SalesDiagnostics/></TabsContent><TabsContent value="traffic"><TrafficDiagnostics/></TabsContent><TabsContent value="changes">{allowed('reports:read') && activeTab === 'changes' && <ChangeHistory key={scope.tenure + ':' + scope.lifetime + ':' + formGeneration}/>}</TabsContent><TabsContent value="promos"><PromoAnalytics/></TabsContent><TabsContent value="team"><TeamAdmin team={data.team ?? null} busy={busy} formKey={formGeneration} onDraft={() => markDraft('staff')} onAdd={e => submit(e, 'staff', d => ({ email: d.email, name: d.name, role: d.role, active: true }))} onChange={(member, patch) => change('staff', { email: member.email, name: member.name, role: patch.role ?? member.role, active: patch.active ?? Boolean(member.active) }, result => toast.success(result.message || 'Saved'))}/></TabsContent></Tabs></Fragment>; }
