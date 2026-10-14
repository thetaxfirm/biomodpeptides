'use client';
// Admin Orders tab: status tabs with counts, one search box, a compact table with one next step
// per order, and the full order in a side panel. Paging and search run on the server.
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { issueTypes, issueLabel } from '@/lib/request-issues';
import { api, report } from './provider';
import { Field } from './primitives';
import { money } from '@/lib/catalog';
import { fulfillmentLabel } from '@/lib/fulfillment';
import { bucketStatus, queueTabs, type QueueResult, type QueueRow, type QueueTab, type OrderBucket } from '@/lib/order-queue';
import { CarrierConnection } from './fulfillment-admin';
import { ShippingLabel } from './shipping-admin';
import { OrderDetails } from './order-admin';
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
};

export function StatusBadge({ bucket }: { bucket: OrderBucket }) {
    const s = bucketStatus[bucket];
    return <span className={'order-status order-status-' + s.tone}>{s.label}</span>;
}

const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();
const units = (o: QueueRow) => (Array.isArray(o.data?.items) ? o.data.items : []).reduce((n: number, i: any) => n + (Number(i?.quantity) || 0), 0);
const place = (o: QueueRow) => [o.data?.address?.city, o.data?.address?.state].filter(Boolean).join(', ');

/** A bought label can be confirmed as handed to the carrier straight from the queue. */
export const canConfirmShipped = (o: QueueRow, allowed: (permission: string) => boolean) =>
    allowed('orders:fulfill') && o.bucket === 'label' && ['paid', 'shipped'].includes(o.status);

/**
 * Queue shortcut for the manual "handed to carrier" confirmation already in the order panel.
 * Keeps the tracking number recorded with the label; never buys or voids anything.
 */
export function MarkShipped({ order, busy, change }: { order: QueueRow; busy: boolean; change: (action: string, body: any, onSaved?: (result: any) => void) => Promise<void> }) {
    const number = orderNumber(order.id);
    function click() {
        const ask = typeof window === 'undefined' ? undefined : window.confirm;
        if (ask && !ask('Mark ' + number + ' as shipped? This records a store confirmation that the parcel is with the carrier, and the customer is told it has shipped.')) return;
        void change('order', { id: order.id, status: 'shipped', tracking: order.data?.tracking || '' }, () => toast.success(number + ' marked shipped.'));
    }
    return <button type="button" className="text-button" disabled={busy} onClick={click}>Mark shipped</button>;
}

function query(params: Record<string, string | number>) {
    const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)]));
    return api('admin-orders?' + search.toString()) as Promise<QueueResult>;
}

export function OrdersAdmin({ reloadToken, checkoutRecovery, allowed, busy, formGeneration, change, submit, markDraft, reload, onEmailCustomer, onReportProblem, onClearHold }: Props) {
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
        return report ? <span className={styles.nextGroup}>{step}{report}</span> : step;
    }
    function mainStep(o: QueueRow, s: any) {
        if (o.bucket === 'to_ship' && allowed('orders:fulfill')) return <ShippingLabel order={o} onDone={reload} compact/>;
        if (o.bucket === 'label' && s?.labelUrl) return <span className={styles.nextGroup}>
            <a className="text-button" href={s.labelUrl} target="_blank" rel="noopener">Print label</a>
            {canConfirmShipped(o, allowed) && <MarkShipped order={o} busy={busy} change={change}/>}
        </span>;
        if ((o.bucket === 'shipped' || o.bucket === 'delivered') && s?.trackingUrl) return <a className="text-button" href={s.trackingUrl} target="_blank" rel="noopener">Track</a>;
        if ((o.bucket === 'unpaid' || o.bucket === 'review') && canReconcile(o)) return <button type="button" className="text-button" disabled={busy} onClick={() => reconcile(o)}>Check payment</button>;
        return <button type="button" className="text-button" onClick={() => setSelected(o)}>View</button>;
    }

    const counts = result?.counts;
    const current = queueTabs.find(t => t.id === tab)!;
    const recoveryJobs = (id: string) => (checkoutRecovery?.jobs || []).filter((j: any) => j.order_id === id);

    return <section className={styles.orders} aria-labelledby="orders-title">
        <div className={styles.heading}>
            <div><h2 id="orders-title">Orders</h2><p>Paid orders waiting to ship come first. Select an order number for the full order.</p></div>
            <label className={styles.search}>Search orders
                <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="Name, email, order number or tracking"/>
            </label>
        </div>
        <div className={styles.tabs} role="group" aria-label="Order status">
            {queueTabs.map(t => <button key={t.id} type="button" aria-pressed={tab === t.id} className={t.id === 'test' ? styles.quiet : undefined} onClick={() => setTab(t.id)}>{t.label}<span>{counts ? counts[t.id] : '…'}</span></button>)}
        </div>
        {error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => fetchPage(0)}>Retry</button></div>}
        {result && <p className={styles.summary} role="status">
            {result.total} {result.total === 1 ? 'order' : 'orders'} in {current.label}{q ? ' matching “' + q + '”' : ''}{tab === 'to_ship' || tab === 'label' ? ', oldest first' : ', newest first'}.
            {result.truncated ? ' Only the most recent ' + result.scanned.toLocaleString() + ' orders are included.' : ''}
        </p>}
        {!rows.length ? <p className={styles.empty}>{loading ? 'Loading orders…' : q ? 'No orders match this search in ' + current.label + '. Try All.' : 'No orders in ' + current.label + '.'}</p> :
            <table className={styles.table}>
                <thead><tr><th>Order</th><th>Customer</th><th className={styles.number}>Items</th><th className={styles.number}>Total</th><th>Status</th><th>Next step</th></tr></thead>
                <tbody>{rows.map(o => <tr key={o.id}>
                    <td><button type="button" className={styles.orderButton} onClick={() => setSelected(o)}>{orderNumber(o.id)}</button><span className={styles.sub}>{new Date(o.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></td>
                    <td>{o.data?.address?.name || 'Name not recorded'}<span className={styles.sub}>{[place(o), o.data?.email].filter(Boolean).join(' · ')}</span></td>
                    <td className={styles.number}>{units(o)}</td>
                    <td className={styles.number}>{money(Number(o.total) || 0)}</td>
                    <td><StatusBadge bucket={o.bucket}/></td>
                    <td className={styles.next}>{nextStep(o)}</td>
                </tr>)}</tbody>
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
                    <OrderDetails order={selected}/>
                    {selected.data?.recovery?.savings > 0 && <p>Additional 7.5% recovery savings: {money(selected.data.recovery.savings)}. Original promo attribution retained.</p>}
                    {recoveryJobs(selected.id).map((j: any) => <p key={j.order_id}>Recovery email: {j.status === 'accepted' ? 'Accepted by mail provider' : j.status === 'review' ? 'Needs manual review' : j.status}. {String(j.reason || '').replaceAll('_', ' ')}{j.accepted_at ? ' · ' + new Date(j.accepted_at).toLocaleString() : ''}</p>)}
                    <div className={styles.actions}>
                        <h3>Actions</h3>
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
