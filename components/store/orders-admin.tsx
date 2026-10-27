'use client';
// Admin Orders tab: status tabs with counts, one search box, a compact table with one next step
// per order, and the full order in a side panel. Paging and search run on the server.
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { issueTypes, issueLabel } from '@/lib/request-issues';
import { winBackTemplates } from '@/lib/win-back';
import { orderMessageLabel, type OrderMessageLog } from '@/lib/order-messages';
import { api, report } from './provider';
import { Field } from './primitives';
import { money } from '@/lib/catalog';
import { fulfillmentLabel, awaitingLabelApproval, carrierWords, stalledLabel, stuckInTransit, unreadableParcel } from '@/lib/fulfillment';
import { shipDue } from '@/lib/ship-cutoff';
import { bucketStatus, queueTabs, canArchive, isArchived, dismissibleReview, flagDismissed, closedReason, type QueueResult, type QueueRow, type QueueTab, type OrderBucket } from '@/lib/order-queue';
import { CarrierConnection } from './fulfillment-admin';
import { ShippingLabel, post as shippingPost } from './shipping-admin';
import { OrderDetails } from './order-admin';
import { paymentLine, paymentAdvice, savedPaymentCheck, savedPaymentVerification, paymentConfirmed, verificationLabel } from '@/lib/payment-check';
import styles from './orders-admin.module.css';

type Props = {
    reloadToken: number;
    checkoutRecovery: any;
    allowed: (permission: string) => boolean;
    busy: boolean;
    formGeneration: number;
    change: (action: string, body: any, onSaved?: (result: any) => void) => Promise<void>;
    submit: (e: FormEvent<HTMLFormElement>, action: string, transform: (d: any) => any, draftKey: string) => Promise<void>;
    markDraft: (key: string) => void;
    reload: () => void;
    /** Opens (or reuses) a reply-desk conversation with this order's customer. Never sends by itself. */
    onEmailCustomer?: (order: QueueRow) => void;
    /** Puts the order on hold for a problem and opens the customer email. Nothing is sent by itself. */
    onReportProblem?: (order: QueueRow, problem: { issue: string; note: string }) => Promise<void>;
    onClearHold?: (order: QueueRow) => Promise<void>;
    /** Unpaid checkouts: put the chosen win-back email in the reply desk as a draft. Never sends by itself. */
    onWinBack?: (order: QueueRow, template: string) => void;
};

export function StatusBadge({ bucket }: { bucket: OrderBucket }) {
    const s = bucketStatus[bucket];
    return <span className={'order-status order-status-' + s.tone}>{s.label}</span>;
}

const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();
const units = (o: QueueRow) => (Array.isArray(o.data?.items) ? o.data.items : []).reduce((n: number, i: any) => n + (Number(i?.quantity) || 0), 0);
const place = (o: QueueRow) => [o.data?.address?.city, o.data?.address?.state].filter(Boolean).join(', ');
const shortTime = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
/** What the carrier last said in plain words, and when it said it. Empty until a label exists. */
function carrierLine(o: QueueRow) {
    const s = o.data?.shipment;
    if (!s?.status) return '';
    const words = carrierWords[s.status] || String(s.status).replaceAll('_', ' ');
    if (stuckInTransit(o)) return 'No carrier update since ' + shortTime(s.checkedAt);
    if (s.status === 'unknown' || s.status === 'pre_transit') {
        // A parcel the carrier will not return tracking for is not the same as one it has not
        // scanned, and sending staff to look for the box is the wrong instruction.
        if (unreadableParcel(o)) return 'Carrier will not return tracking · check the label in EasyPost';
        const handoff = Number.isFinite(o.data?.handoff?.at) ? 'Dropped off ' + shortTime(o.data.handoff.at) : stalledLabel(o) ? 'Not dropped off' : '';
        return [stalledLabel(o) ? 'Not scanned 24h+' : words, handoff].filter(Boolean).join(' · ');
    }
    return words + (Number.isFinite(s.checkedAt) ? ' · ' + shortTime(s.checkedAt) : '');
}
/** Insurance and signature bought with the label, so staff know what the parcel carries. */
function protectionLine(o: QueueRow) {
    const s = o.data?.shipment;
    return [s?.insuredCents ? 'Insured ' + money(s.insuredCents) : '', s?.signature ? 'Signature' : ''].filter(Boolean).join(' · ');
}
/** The line under the status: what the carrier said, why an order closed, and when it was archived. */
function statusLine(o: QueueRow) {
    const archived = isArchived(o) ? 'Archived ' + new Date(o.data.archivedAt).toLocaleDateString([], { dateStyle: 'medium' }) : '';
    const why = o.bucket === 'closed' ? closedReason(o) : '';
    // Says so when a flag was accepted, so a returning or unscanned parcel sitting under Shipped is
    // never a mystery: the carrier words beside it are still the carrier's own.
    const dismissed = flagDismissed(o) ? 'Flag dismissed ' + shortTime(Number(o.data.dismissed.at)) + ' by ' + String(o.data.dismissed.by || 'staff') : '';
    // What Authorize.net said, for an order that is not paid yet (owner, Oct 23 2026: say WHY it needs review).
    const payment = ['unpaid', 'review'].includes(o.bucket) && !o.data?.hold ? paymentLine(savedPaymentCheck(o.data?.paymentCheck)) : '';
    return [payment, o.data?.shipment?.status ? carrierLine(o) : why, protectionLine(o), dismissed, archived].filter(Boolean).join(' · ');
}

/**
 * Whether the money for this order has been confirmed at the provider, shown on every tab beside the
 * order number (owner, Oct 27 2026). Three states on purpose: a check once a scheduled re-check found
 * a capture for the exact order total, a warning when the provider would not stand behind it, and
 * nothing at all until it has been asked. Silence is never a pass.
 */
function PaymentVerified({ order }: { order: QueueRow }) {
    const verified = savedPaymentVerification(order.data?.paymentVerified);
    if (!verified) return null;
    const ok = paymentConfirmed(verified);
    const label = verificationLabel(verified);
    return <span className={ok ? styles.verified : styles.unverified} role="img" aria-label={label} title={label}>{ok ? '✓' : '⚠'}</span>;
}

const money2 = (c: number | null) => c === null ? '' : money(c);
/** Every card attempt on this order as Authorize.net reported it, what to do, and the owner's Approve/Decline. */
function PaymentPanel({ order, owner, busy, change }: { order: QueueRow; owner: boolean; busy: boolean; change: Props['change'] }) {
    const check = savedPaymentCheck(order.data?.paymentCheck);
    if (!check || ['paid', 'labeling', 'shipped', 'delivered'].includes(order.status)) return null;
    const decide = (transId: string, decision: 'approve' | 'decline') => {
        const ask = typeof window === 'undefined' ? undefined : window.confirm;
        const question = decision === 'approve'
            ? 'Approve this payment? Authorize.net collects ' + money(Number(order.total) || 0) + ' from the customer\'s card and the order moves to To ship.'
            : 'Decline this payment? The customer is not charged and the hold on their card is released. The order stays unpaid.';
        if (ask && !ask(question)) return;
        void change('payment-hold', { id: order.id, transId, decision }, r => toast.success(r?.message || 'Done.'));
    };
    return <div className={styles.messageLog}>
        <h3>Payment at Authorize.net</h3>
        <p>{paymentAdvice(check)}</p>
        {check.attempts.length ? <ul>{check.attempts.map(a => <li key={a.transId}>
            <span><strong>{a.words}</strong>{a.amountCents !== null ? ' · ' + money2(a.amountCents) : ''}</span>
            <span className={styles.sub}>{[a.card, a.submittedAt ? new Date(a.submittedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '', 'Transaction ' + a.transId].filter(Boolean).join(' · ')}</span>
            {a.filters.length > 0 && <span className={styles.sub}>Flagged by: {a.filters.map(f => f.name + (f.action ? ' (' + f.action + ')' : '')).join(', ')}</span>}
            {(a.avs || a.cvv) && <span className={styles.sub}>{[a.avs, a.cvv].filter(Boolean).join(' · ')}</span>}
            {a.reason && <span className={styles.sub}>Bank: {a.reason}</span>}
            {a.kind === 'held' && owner && <span className={styles.nextGroup}>
                <button type="button" className="button button-dark" disabled={busy} onClick={() => decide(a.transId, 'approve')}>Approve payment</button>
                <button type="button" className="text-button" disabled={busy} onClick={() => decide(a.transId, 'decline')}>Decline</button>
            </span>}
            {a.kind === 'held' && !owner && <span className={styles.sub}>Only an owner can approve or decline a held payment.</span>}
        </li>)}</ul> : null}
        <p className={styles.sub}>Checked {new Date(check.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Press Check payment for the latest.</p>
    </div>;
}

/** A bought label not yet handed over can be marked dropped off straight from the queue. */
export const canMarkDroppedOff = (o: QueueRow, allowed: (permission: string) => boolean) =>
    allowed('orders:fulfill') && o.bucket === 'label' && ['paid', 'shipped'].includes(o.status) && !o.data?.handoff;

/**
 * Records that the parcel left the building. Changes no status and emails nobody: the order moves to
 * Shipped only when the carrier scans it, so the queue never claims a shipment the carrier has not seen.
 */
export function DroppedOff({ order, busy, change }: { order: QueueRow; busy: boolean; change: (action: string, body: any, onSaved?: (result: any) => void) => Promise<void> }) {
    const number = orderNumber(order.id);
    function click() {
        const ask = typeof window === 'undefined' ? undefined : window.confirm;
        if (ask && !ask('Mark ' + number + ' as dropped off with the carrier? The customer is not emailed. It moves to Shipped when the carrier scans it.')) return;
        void change('order-handoff', { orderId: order.id }, r => toast.success(r?.message || number + ' marked dropped off.'));
    }
    return <button type="button" className="text-button" disabled={busy} onClick={click}>Dropped off</button>;
}

/** Sent as a body, never a query string: the search term is a customer's own contact details. */
function query(params: Record<string, string | number>) {
    const body = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)]));
    return api('admin-orders', body) as Promise<QueueResult>;
}

/** Every message sent to this customer, newest first (owner, Oct 15 2026). */
const messagesOf = (o: QueueRow): OrderMessageLog => (o as QueueRow & { messages?: OrderMessageLog }).messages || { count: 0, last: null, items: [] };
const sentAt = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
function MessagedCell({ order }: { order: QueueRow }) {
    const log = messagesOf(order);
    if (!log.last) return <span className={styles.notMessaged}>Not contacted</span>;
    const all = log.items.map(m => orderMessageLabel[m.kind] + ' · ' + sentAt(m.at)).join('\n');
    return <span title={all}>{orderMessageLabel[log.last.kind]}<span className={styles.sub}>{sentAt(log.last.at)}{log.count > 1 ? ' · ' + log.count + ' sent' : ''}</span></span>;
}
export function OrdersAdmin({ reloadToken, checkoutRecovery, allowed, busy, formGeneration, change, submit, markDraft, reload, onEmailCustomer, onReportProblem, onClearHold, onWinBack }: Props) {
    const [problem, setProblem] = useState<{ issue: string; note: string }>({ issue: 'out_of_stock', note: '' });
    const [tab, setTab] = useState<QueueTab>('to_ship');
    const [input, setInput] = useState('');
    const [q, setQ] = useState('');
    const [result, setResult] = useState<QueueResult | null>(null);
    const [rows, setRows] = useState<QueueRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState<QueueRow | null>(null);
    const sequence = useRef(0);

    // Search waits for a short pause in typing.
    useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 250); return () => clearTimeout(t); }, [input]);

    async function fetchPage(offset: number) {
        const request = ++sequence.current;
        setLoading(true); setError('');
        try {
            const page = await query({ tab, q, offset });
            if (request !== sequence.current) return;
            setResult(page);
            setRows(previous => offset ? [...previous, ...page.orders] : page.orders);
        } catch {
            if (request === sequence.current) setError('Orders could not load. Retry, or refresh administration.');
        } finally {
            if (request === sequence.current) setLoading(false);
        }
    }
    useEffect(() => { void fetchPage(0); }, [tab, q, reloadToken]);

    // Keep the open panel current after an action, even when the order moves to another tab.
    useEffect(() => {
        if (!selected) return;
        let live = true;
        query({ id: selected.id }).then(page => { if (live && page.orders[0]) setSelected(page.orders[0]); }).catch(() => undefined);
        return () => { live = false; };
    }, [reloadToken]);

    const reconcile = (o: QueueRow) => change('reconcile', { id: o.id }, d => toast.info(d.message || d.status));
    const canReconcile = (o: QueueRow) => allowed('orders:reconcile') && !['paid', 'shipped', 'delivered'].includes(o.status) && !o.data?.shipment;

    function nextStep(o: QueueRow) {
        const s = o.data?.shipment;
        if (o.data?.hold) return <span className={styles.nextGroup}>
            <span className={styles.holdTag}>On hold: {issueLabel(o.data.hold.issue)}</span>
            {onEmailCustomer && o.data?.email && <button type="button" className="text-button" disabled={busy} onClick={() => onEmailCustomer(o)}>Email customer</button>}
        </span>;
        const report = onReportProblem && !['closed', 'delivered', 'test'].includes(o.bucket) ? <button type="button" className="text-button" onClick={() => { setProblem({ issue: 'out_of_stock', note: '' }); setSelected(o); }}>Report problem</button> : null;
        const step = mainStep(o, s);
        const winBack = onWinBack && o.bucket === 'unpaid' && o.data?.email ? <select className={styles.winBack} value="" disabled={busy} aria-label={'Send ' + (o.data?.address?.name || 'this customer') + ' a win-back email'} onChange={e => { if (e.target.value) onWinBack(o, e.target.value); }}>
            <option value="">Win back…</option>{winBackTemplates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select> : null;
        const archive = archiveButton(o);
        const dismiss = dismissButton(o);
        return report || winBack || archive || dismiss ? <span className={styles.nextGroup}>{step}{winBack}{report}{dismiss}{archive}</span> : step;
    }
    /**
     * Accepts a carrier flag nobody can clear by hand: not scanned, no update in four days, or a
     * carrier problem. The order leaves Needs review and the daily parcel email. Nothing about the
     * order changes, and a different carrier status brings the flag back on its own.
     */
    function dismissButton(o: QueueRow) {
        if (!allowed('orders:fulfill')) return null;
        const number = orderNumber(o.id);
        const send = (b: Record<string, unknown>, done: string) => {
            shippingPost({ id: o.id, ...b }).then(r => { toast.success(r?.message || done); reload(); }).catch(e => toast.error(e instanceof Error ? e.message : 'Request failed.'));
        };
        if (flagDismissed(o)) return <button type="button" className="text-button" disabled={busy} onClick={() => send({ undoDismiss: true }, number + ' is back in Needs review.')}>Undo dismiss</button>;
        if (!dismissibleReview(o)) return null;
        function click() {
            const ask = typeof window === 'undefined' ? undefined : window.confirm;
            if (ask && !ask('Dismiss the carrier flag on ' + number + '? It moves to Shipped and stops appearing in the daily parcel email. The customer is not emailed, and nothing about the order changes. If the carrier later reports something different, the flag comes back.')) return;
            send({ dismiss: true }, number + ' dismissed.');
        }
        return <button type="button" className="text-button" disabled={busy} onClick={click}>Dismiss flag</button>;
    }
    /** Files a finished order away, or brings it back. Only for orders with nothing left to do. */
    function archiveButton(o: QueueRow) {
        if (!allowed('orders:fulfill')) return null;
        const number = orderNumber(o.id);
        if (isArchived(o)) return <button type="button" className="text-button" disabled={busy} onClick={() => void change('order-archive', { orderId: o.id, restore: true }, r => toast.success(r.message || number + ' restored.'))}>Restore</button>;
        if (!canArchive(o.bucket)) return null;
        return <button type="button" className="text-button" disabled={busy} onClick={() => void change('order-archive', { orderId: o.id }, r => toast.success(r.message || number + ' archived.'))}>Archive</button>;
    }
    function mainStep(o: QueueRow, s: any) {
        const noCoa = (o as QueueRow & { coaMissing?: string[] }).coaMissing || [];
        if (noCoa.length && (o.bucket === 'to_ship' || o.bucket === 'label')) return <span className={styles.coaHold}>Can't ship: no COA for {noCoa.join(', ')}</span>;
        // Buying it is the approval, so the button stays right next to the price that needs approving.
        if (awaitingLabelApproval(o)) return <span className={styles.nextGroup}>
            <span className={styles.coaHold}>{money(Number(o.data?.labelApproval?.cents) || 0)} label · over your {money(Number(o.data?.labelApproval?.limitCents) || 0)} limit</span>
            {allowed('orders:fulfill') ? <ShippingLabel order={o} onDone={reload} compact/> : null}
        </span>;
        if (o.bucket === 'to_ship' && allowed('orders:fulfill')) return <ShippingLabel order={o} onDone={reload} compact/>;
        if (o.bucket === 'label' && s?.labelUrl) return <span className={styles.nextGroup}>
            <a className="text-button" href={s.labelUrl} target="_blank" rel="noopener">Print label</a>
            {canMarkDroppedOff(o, allowed) && <DroppedOff order={o} busy={busy} change={change}/>}
        </span>;
        if ((o.bucket === 'shipped' || o.bucket === 'delivered') && s?.trackingUrl) return <a className="text-button" href={s.trackingUrl} target="_blank" rel="noopener">Track</a>;
        if ((o.bucket === 'unpaid' || o.bucket === 'review') && canReconcile(o)) return <span className={styles.nextGroup}>
            {o.data?.paymentCheck && <button type="button" className="text-button" onClick={() => setSelected(o)}>Payment details</button>}
            <button type="button" className="text-button" disabled={busy} onClick={() => reconcile(o)}>Check payment</button>
        </span>;
        return <button type="button" className="text-button" onClick={() => setSelected(o)}>View</button>;
    }

    const counts = result?.counts;
    const current = queueTabs.find(t => t.id === tab)!;
    const recoveryJobs = (id: string) => (checkoutRecovery?.jobs || []).filter((j: any) => j.order_id === id);

    return <section className={styles.orders} aria-labelledby="orders-title">
        <div className={styles.heading}>
            <div><h2 id="orders-title">Orders</h2><p>Paid orders waiting to ship come first. Select an order number for the full order.</p>
                <div className={styles.sheetButtons}>
                    <a className="button button-dark" href="/api/admin/pick-list" target="_blank" rel="noopener">Print pick list</a>
                    {allowed('orders:fulfill') && <a className="button button-gold" href="/api/admin/labels" target="_blank" rel="noopener">Print all bought labels</a>}
                    <span>Printing changes nothing.</span>
                </div></div>
            <label className={styles.search}>Search orders
                <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="Name, email, order number or tracking"/>
            </label>
        </div>
        <div className={styles.tabs} role="group" aria-label="Order status">
            {queueTabs.map(t => <button key={t.id} type="button" aria-pressed={tab === t.id} className={t.id === 'test' ? styles.quiet : undefined} onClick={() => setTab(t.id)}>{t.label}<span>{counts ? counts[t.id] : '…'}</span></button>)}
        </div>
        {result?.noCoa && result.noCoa.length > 0 && (() => {
            const holding = result.noCoa.filter(p => p.waitingOrders > 0), rest = result.noCoa.length - holding.length;
            const table = (rows: typeof holding) => <table><thead><tr><th>Product</th><th>Lot being sold</th><th className={styles.number}>Paid orders waiting</th></tr></thead>
                <tbody>{rows.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.lot || 'No lot recorded'}</td><td className={styles.number}>{p.waitingOrders || ''}</td></tr>)}</tbody></table>;
            return <div className={styles.noCoa} data-holding={holding.length > 0}>
                {holding.length > 0 ? <><p><strong>{holding.reduce((n, p) => n + p.waitingOrders, 0)} paid {holding.reduce((n, p) => n + p.waitingOrders, 0) === 1 ? 'order is' : 'orders are'} waiting on a missing COA.</strong> They can't get a label or be marked shipped until the COA for the current lot is attached under Products.</p>{table(holding)}</>
                    : <p>No paid order is waiting on a missing COA.</p>}
                <details><summary>{holding.length ? `${rest} more ${rest === 1 ? 'product' : 'products'}` : `${result.noCoa.length} ${result.noCoa.length === 1 ? 'product' : 'products'}`} for sale without a COA</summary>{table(result.noCoa.filter(p => !p.waitingOrders))}</details>
            </div>;
        })()}
        {error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => fetchPage(0)}>Retry</button></div>}
        {result?.mustGoOut && (() => {
            // The 2 p.m. Pacific same-day promise, counted across every tab (lib/ship-cutoff.ts).
            const { today, late } = result.mustGoOut, total = today + late;
            if (!total) return <p className={styles.cutoffClear}>Nothing has to go out today.</p>;
            return <div className={styles.cutoff} data-late={late > 0 || undefined}>
                <span className={styles.star} aria-hidden="true">★</span>
                <p><strong>{total} {total === 1 ? 'order has' : 'orders have'} to go out today</strong>{late ? ` (${late} late)` : ''}. Paid in-stock orders placed before 2 p.m. Pacific on a business day go out that day; later orders go out the next business day. Hand them to USPS, then press Dropped off.</p>
            </div>;
        })()}
        {result && <p className={styles.summary} role="status">
            {result.total} {result.total === 1 ? 'order' : 'orders'} in {current.label}{q ? ' matching “' + q + '”' : ''}{tab === 'to_ship' || tab === 'label' ? ', oldest first' : ', newest first'}.
            {result.truncated ? ' Only the most recent ' + result.scanned.toLocaleString() + ' orders are included.' : ''}
        </p>}
        {!rows.length ? <p className={styles.empty}>{loading ? 'Loading orders…' : q ? 'No orders match this search in ' + current.label + '. Try All.' : 'No orders in ' + current.label + '.'}</p> :
            <table className={styles.table}>
                <thead><tr><th>Order</th><th>Customer</th><th className={styles.number}>Items</th><th className={styles.number}>Total</th><th>Status</th><th>Messaged</th><th>Next step</th></tr></thead>
                <tbody>{rows.map(o => { const due = shipDue(o); const urgent = due && due.state !== 'upcoming'; return <tr key={o.id}>
                    <td>{urgent && <span className={styles.star} role="img" aria-label={due.label} title={due.label}>★</span>}<button type="button" className={styles.orderButton} onClick={() => setSelected(o)}>{orderNumber(o.id)}</button><PaymentVerified order={o}/>{due && <span className={urgent ? styles.dueUrgent : styles.sub}>{due.label}</span>}<span className={styles.sub}>{new Date(o.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></td>
                    <td>{o.data?.address?.name || 'Name not recorded'}<span className={styles.sub}>{[place(o), o.data?.email].filter(Boolean).join(' · ')}</span></td>
                    <td className={styles.number}>{units(o)}</td>
                    <td className={styles.number}>{money(Number(o.total) || 0)}</td>
                    <td><StatusBadge bucket={o.bucket}/>{statusLine(o) && <span className={styles.sub}>{statusLine(o)}</span>}</td>
                    <td className={styles.messaged}><MessagedCell order={o}/></td>
                    <td className={styles.next}>{nextStep(o)}</td>
                </tr>; })}</tbody>
            </table>}
        {result?.hasMore && <div className={styles.more}><button type="button" className="button button-dark" disabled={loading} onClick={() => fetchPage(rows.length)}>{loading ? 'Loading…' : 'Load more (' + (result.total - rows.length) + ' left)'}</button></div>}

        <details className={styles.help}>
            <summary>Shipping and checkout help</summary>
            <div className={styles.recovery}>
                <h3>Unpaid checkout recovery</h3>
                <p>{checkoutRecovery?.enabled ? 'Enabled for new checkouts' : 'Not enabled'}. One reminder after 24 hours without payment or payment-page activity, with an additional 7.5% off after existing discounts. Internal tests and payments under review are excluded.</p>
                <p>Last scheduler check: {checkoutRecovery?.health?.checkedAt ? new Date(checkoutRecovery.health.checkedAt).toLocaleString() + ' · ' + checkoutRecovery.health.status : 'Not recorded'}. Accepted by the mail provider does not confirm inbox delivery.</p>
            </div>
            <CarrierConnection/>
        </details>

        <Sheet open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
            <SheetContent side="right" className={styles.panel}>
                {selected && <>
                    <div className={styles.panelHead}><SheetTitle asChild><h2>Order {orderNumber(selected.id)}</h2></SheetTitle><StatusBadge bucket={selected.bucket}/></div>
                    <SheetDescription className={styles.panelMeta}>{new Date(selected.created).toLocaleString()} · {money(Number(selected.total) || 0)}</SheetDescription>
                    <p className={styles.statusLine}>{fulfillmentLabel(selected)}</p>
                    {awaitingLabelApproval(selected) && <p className={styles.coaHold}>This label quotes {money(Number(selected.data?.labelApproval?.cents) || 0)}, above your {money(Number(selected.data?.labelApproval?.limitCents) || 0)} automatic limit, so it was not bought. Buying it below approves that cost. Nothing has been charged.</p>}
                    <div className={styles.messageLog}>
                        <h3>Messages sent</h3>
                        {messagesOf(selected).items.length
                            ? <ul>{messagesOf(selected).items.map((m, i) => <li key={m.kind + m.at + i}><span>{orderMessageLabel[m.kind]}</span><span className={styles.sub}>{sentAt(m.at)}{m.by && m.kind !== 'auto_reminder' ? ' · ' + m.by : ''}</span></li>)}</ul>
                            : <p className={styles.sub}>Nothing sent to this customer yet.</p>}
                        <p className={styles.sub}>Times are when the mail provider accepted the email; inbox delivery is not confirmed.</p>
                    </div>
                    <PaymentPanel order={selected} owner={allowed('team:manage')} busy={busy} change={change}/>
                    <OrderDetails order={selected}/>
                    {selected.data?.recovery?.savings > 0 && <p>Additional 7.5% recovery savings: {money(selected.data.recovery.savings)}. Original promo attribution retained.</p>}
                    {recoveryJobs(selected.id).map((j: any) => <p key={j.order_id}>Recovery email: {j.status === 'accepted' ? 'Accepted by mail provider' : j.status === 'review' ? 'Needs manual review' : j.status}. {String(j.reason || '').replaceAll('_', ' ')}{j.accepted_at ? ' · ' + new Date(j.accepted_at).toLocaleString() : ''}</p>)}
                    <div className={styles.actions}>
                        <h3>Actions</h3>
                        {['to_ship', 'label'].includes(selected.bucket) && <p className={styles.panelMeta}><a className="text-button" href={'/api/admin/pick-list?id=' + encodeURIComponent(selected.id)} target="_blank" rel="noopener">Pick list for this order</a></p>}
                        {selected.data?.hold ? <div className={styles.hold}>
                            <p><strong>On hold: {issueLabel(selected.data.hold.issue)}</strong>{selected.data.hold.note ? ' · ' + selected.data.hold.note : ''}<br/><span className={styles.panelMeta}>By {selected.data.hold.by} · {new Date(selected.data.hold.at).toLocaleString()}. No label or shipping until the hold is cleared.</span></p>
                            {onClearHold && <button type="button" className="text-button" disabled={busy} onClick={() => { const order = selected; void onClearHold(order).then(() => setSelected(null)); }}>Clear hold (problem solved)</button>}
                        </div> : onReportProblem && !['closed', 'delivered', 'test'].includes(selected.bucket) && <form className={styles.problem} onSubmit={event => { event.preventDefault(); const order = selected; setSelected(null); void onReportProblem(order, problem); }}>
                            <p><strong>Report a problem</strong> <span className={styles.panelMeta}>Holds the order (no label, no shipping) and opens an email to the customer. Nothing is sent until you press Send.</span></p>
                            <label>What is wrong<select value={problem.issue} onChange={e => setProblem({ ...problem, issue: e.target.value })}>{issueTypes.filter(([k]) => !['partner', 'vendor', 'coa'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                            <label>Note (optional)<input value={problem.note} maxLength={500} onChange={e => setProblem({ ...problem, note: e.target.value })} placeholder="e.g. Restock expected late November"/></label>
                            <button type="submit" className="button button-dark" disabled={busy}>Hold order and email customer</button>
                        </form>}
                        {onEmailCustomer && selected.data?.email && <button type="button" className="button button-dark" disabled={busy} onClick={() => { const order = selected; setSelected(null); onEmailCustomer(order); }}>Email customer</button>}
                        {canReconcile(selected) && <button type="button" className="button button-dark" disabled={busy} onClick={() => reconcile(selected)}>Check payment status</button>}
                        {allowed('orders:fulfill') && !selected.data?.hold && <ShippingLabel order={selected} onDone={reload}/>}
                        {allowed('orders:fulfill') && !selected.data?.hold && ['paid', 'shipped'].includes(selected.status) && (selected.data?.shipment
                            ? <details className={styles.manual}><summary>Manual confirmation (only if the carrier is not tracking this parcel)</summary><ManualForm order={selected} formGeneration={formGeneration} submit={submit} markDraft={markDraft} busy={busy}/></details>
                            : <ManualForm order={selected} formGeneration={formGeneration} submit={submit} markDraft={markDraft} busy={busy}/>)}
                        {!allowed('orders:fulfill') && !canReconcile(selected) && <p className={styles.panelMeta}>No actions available for your role on this order.</p>}
                    </div>
                </>}
            </SheetContent>
        </Sheet>
    </section>;
}

function ManualForm({ order, formGeneration, submit, markDraft, busy }: { order: QueueRow; formGeneration: number; submit: Props['submit']; markDraft: Props['markDraft']; busy: boolean }) {
    const key = 'order:' + order.id;
    return <form key={formGeneration} className="form-row" onChangeCapture={() => markDraft(key)} onSubmit={e => submit(e, 'order', d => ({ ...d, id: order.id }), key)}>
        <Field label="Tracking number / carrier" name="tracking" defaultValue={order.data?.tracking}/>
        <Field label="Manual fulfillment confirmation" name="status"><select name="status"><option value="shipped">Handed to carrier (store confirmation)</option><option value="delivered">Delivered (store confirmation)</option></select></Field>
        <button className="button button-dark" disabled={busy}>Update fulfillment</button>
    </form>;
}
