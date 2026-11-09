'use client';
// Label and delivery for every order, wherever staff open an order or a customer (owner, Nov 8 2026:
// "there is no way to look and see the labels and if they have been delivered. add that for all
// customers. have it available anytime that we open their account").
// LabelCell is the Label column of the Orders table. CustomerOrders lists every order one customer
// placed with Order, Items, Total, Payment, Shipment, Label, Last contact recorded and Next step, in
// the order panel and the reply desk. Read-only: opening a label never buys or changes anything.
import { useEffect, useState } from 'react';
import { api } from './provider';
import { money } from '@/lib/catalog';
import { orderPaymentStatus, orderShipmentStatus } from '@/lib/fulfillment';
import { labelSummary, nextStepWords, trackPageUrl } from '@/lib/order-label';
import { orderMessageLabel, type OrderMessageLog } from '@/lib/order-messages';
import type { QueueResult, QueueRow } from '@/lib/order-queue';
import styles from './customer-orders.module.css';

const day = (at: number | null) => at ? new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const stamp = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const number = (id: string) => '#' + id.slice(0, 8).toUpperCase();
const units = (o: QueueRow) => (Array.isArray(o.data?.items) ? o.data.items : []).reduce((n: number, i: any) => n + (Number(i?.quantity) || 0), 0);
const itemWords = (o: QueueRow) => (Array.isArray(o.data?.items) ? o.data.items : []).slice(0, 6)
    .map((i: any) => (Number(i?.quantity) > 1 ? Number(i.quantity) + ' × ' : '') + String(i?.product?.name || 'Item')).join(', ');

/** Is there a label, can I open it, and did the carrier deliver it. */
export function LabelCell({ order }: { order: QueueRow }) {
    const label = labelSummary(order);
    if (label.state !== 'bought') return <span className={label.state === 'missing' ? styles.missing : styles.quiet} data-label-state={label.state}>
        {label.state === 'missing' ? <strong>Missing</strong> : null}
        <span className={styles.sub}>{label.words}{label.tracking ? ' · ' + label.tracking : ''}</span>
    </span>;
    const carrier = label.carrier + (label.carrierAt ? ' · ' + day(label.carrierAt) : '');
    return <span className={styles.label} data-label-state="bought">
        <span className={styles.links}>
            {label.labelUrl ? <a href={label.labelUrl} target="_blank" rel="noopener noreferrer">View label</a> : <span className={styles.missing}>Label file not saved</span>}
            {order.id && <a href={trackPageUrl(order.id)} target="_blank" rel="noopener" title="Carrier scans beside the label, ready to copy">Track</a>}
        </span>
        <span className={styles.sub}>{[label.service, label.tracking].filter(Boolean).join(' · ')}</span>
        {label.boughtAt && <span className={styles.sub}>Bought {day(label.boughtAt)}{label.protection ? ' · ' + label.protection : ''}</span>}
        {!label.boughtAt && label.protection && <span className={styles.sub}>{label.protection}</span>}
        <span className={label.delivered ? styles.delivered : label.problem ? styles.problem : styles.sub}>{label.delivered ? 'Delivered (carrier) · ' + day(label.carrierAt) : carrier}</span>
    </span>;
}

const messagesOf = (o: QueueRow): OrderMessageLog => (o as QueueRow & { messages?: OrderMessageLog }).messages || { count: 0, last: null, items: [] };
function LastContact({ order }: { order: QueueRow }) {
    const log = messagesOf(order);
    if (!log.last) return <span className={styles.quiet}>No contact recorded</span>;
    return <span>{orderMessageLabel[log.last.kind]}<span className={styles.sub}>{stamp(log.last.at)}{log.count > 1 ? ' · ' + log.count + ' recorded' : ''}</span></span>;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; orders: QueueRow[]; more: boolean };

/**
 * Every order this email address placed, newest first, archived ones included. currentId marks the
 * order already open. Sent as a POST body so the email address stays out of URLs and logs.
 */
export function CustomerOrders({ email, currentId, onOpen }: { email: string; currentId?: string; onOpen?: (order: QueueRow) => void }) {
    const address = String(email || '').trim().toLowerCase();
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    useEffect(() => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { setLoad({ state: 'error', message: 'No email address on file, so orders cannot be matched.' }); return; }
        let live = true;
        setLoad({ state: 'loading' });
        Promise.all(['all', 'archived', 'test'].map(tab => api('admin-orders', { tab, q: address }) as Promise<QueueResult>))
            .then(pages => {
                if (!live) return;
                const seen = new Set<string>();
                const orders = pages.flatMap(p => p.orders)
                    .filter(o => String(o.data?.email || '').trim().toLowerCase() === address && !seen.has(o.id) && Boolean(seen.add(o.id)))
                    .sort((a, b) => b.created - a.created);
                setLoad({ state: 'ready', orders, more: pages.some(p => p.hasMore) });
            })
            .catch(e => { if (live) setLoad({ state: 'error', message: e instanceof Error && /permission|staff|sign in/i.test(e.message) ? 'Your role cannot view orders.' : 'Orders could not load. Reopen to retry.' }); });
        return () => { live = false; };
    }, [address]);

    return <section className={styles.customerOrders} aria-label={'Orders for ' + address}>
        <h3>Orders from this customer{load.state === 'ready' ? ' (' + load.orders.length + ')' : ''}</h3>
        {load.state === 'loading' && <p className={styles.quiet} role="status">Loading orders…</p>}
        {load.state === 'error' && <p className={styles.quiet} role="alert">{load.message}</p>}
        {load.state === 'ready' && !load.orders.length && <p className={styles.quiet}>No store orders match this email address. Orders under another email are not shown.</p>}
        {/* One block per order: side panels are too narrow for an eight-column table. */}
        {load.state === 'ready' && load.orders.length > 0 && <ol className={styles.list}>{load.orders.map(o => { const payment = orderPaymentStatus(o), shipment = orderShipmentStatus(o); return <li key={o.id} className={styles.order} data-current={o.id === currentId || undefined}>
            <p className={styles.orderHead}>
                {onOpen && o.id !== currentId ? <button type="button" className={styles.open} onClick={() => onOpen(o)}>{number(o.id)}</button> : <strong>{number(o.id)}</strong>}
                <span>{day(o.created)}{o.id === currentId ? ' · open now' : ''}{o.data?.internalTest ? ' · internal test' : ''}</span>
                <strong className={styles.total}>{money(Number(o.total) || 0)}</strong>
            </p>
            <dl className={styles.facts}>
                <dt>Customer</dt><dd>{o.data?.address?.name || 'Name not recorded'}<span className={styles.sub}>{[o.data?.address?.city, o.data?.address?.state].filter(Boolean).join(', ')}</span></dd>
                <dt>Items</dt><dd>{units(o)} {units(o) === 1 ? 'item' : 'items'}<span className={styles.sub}>{itemWords(o)}</span></dd>
                <dt>Payment</dt><dd><strong>{payment.label}</strong>{payment.detail && <span className={styles.sub}>{payment.detail}</span>}</dd>
                <dt>Shipment</dt><dd><strong>{shipment.label}</strong>{shipment.detail && <span className={styles.sub}>{shipment.detail}</span>}</dd>
                <dt>Label</dt><dd><LabelCell order={o}/></dd>
                <dt>Last contact recorded</dt><dd><LastContact order={o}/></dd>
                <dt>Next step</dt><dd><strong>{nextStepWords(o)}</strong></dd>
            </dl>
        </li>; })}</ol>}
        {load.state === 'ready' && load.more && <p className={styles.quiet}>More than 50 orders match. Search Orders for the rest.</p>}
    </section>;
}
