'use client';

import { useEffect, useRef, useState } from 'react';
import { ReportPeriodControls, useReportPeriod } from './report-period';
import { money } from '@/lib/catalog';
import type { Attention, Overview } from '@/lib/admin-overview';
import { api } from './provider';
import styles from './admin-overview.module.css';

const tabNames: Record<string, string> = { orders: 'Orders', requests: 'Customer requests', products: 'Products', settings: 'Settings' };

function Item({ item, onOpen }: { item: Attention; onOpen: (tab: string, orderView?: string) => void }) {
    return <li className={styles.item} data-tone={item.tone}>
        <span className={styles.count} aria-hidden="true">{item.count || '!'}</span>
        <div className={styles.text}><strong>{item.title}</strong><span>{item.detail}</span></div>
        <button type="button" className={styles.open} onClick={() => onOpen(item.tab, item.id)}>Open {tabNames[item.tab] || item.tab}</button>
    </li>;
}

/** The first screen of administration: what needs doing now, sales, and store setup gaps. */
export function AdminOverview({ onOpen, reloadToken = 0 }: { onOpen: (tab: string, orderView?: string) => void; reloadToken?: number }) {
    const [response, setData] = useState<Overview | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const sequence = useRef(0);
    const period = useReportPeriod('summary');
    const [loadedKey, setLoadedKey] = useState('');
    const key = period.query + ':' + reloadToken;
    const data = loadedKey === key && !loading && !error ? response : null;
    async function load() {
        const request = ++sequence.current;
        setLoading(true); setError('');
        try { const next = await api('admin-overview?' + period.query) as Overview; if (request === sequence.current) { setData(next); setLoadedKey(key); } }
        catch (e) { if (request === sequence.current) setError('Today could not load. ' + (e instanceof Error ? e.message : 'Retry, or open Orders directly.')); }
        finally { if (request === sequence.current) setLoading(false); }
    }
    useEffect(() => { void load(); return () => { sequence.current++; }; }, [reloadToken, period.query]); // eslint-disable-line react-hooks/exhaustive-deps
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: period.selection.timeZone }).format(data?.generatedAt ?? Date.now());
    const work = data ? [...data.setup, ...data.attention] : [];
    return <section className={styles.overview} aria-labelledby="overview-title" aria-busy={loading}>
        <div className={styles.heading}>
            <div><h2 id="overview-title">Today</h2><p>{today}</p></div>
            <button type="button" className="text-button" disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : 'Refresh'}</button>
        </div>
        {(response?.sales || !response) && <ReportPeriodControls control={period} periods={['summary']} label="Sales comparison period"/>}
        {error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => void load()}>Retry</button></div>}
        {!data && !error && <p className={styles.muted} role="status">Checking orders, requests and products…</p>}
        {data && <>
            <h3 className={styles.sectionTitle}>Needs attention</h3>
            {work.length ? <ul className={styles.list}>{work.map(item => <Item key={item.id} item={item} onOpen={onOpen}/>)}</ul>
                : <p className={styles.clear} role="status">No open work was found in the available order, request and product records.</p>}
            {data.sales && <>
                <h3 className={styles.sectionTitle}>Recorded live payments</h3>
                <div className={styles.sales}>{data.sales.map(w => <div key={w.label} className={styles.figure}>
                    <span>{w.label}</span><strong>{money(w.live.grossCents)}</strong><small>{w.live.paymentRecorded} paid {w.live.paymentRecorded === 1 ? 'order' : 'orders'} with payment records</small>
                    {w.live.missingPaymentRecords > 0 && <small>{w.live.missingPaymentRecords} live paid {w.live.missingPaymentRecords === 1 ? 'order' : 'orders'} missing payment records, excluded</small>}
                    {w.sandbox.orders > 0 && <small>{w.sandbox.orders} sandbox {w.sandbox.orders === 1 ? 'order' : 'orders'}, excluded</small>}
                    {w.unknown.orders > 0 && <small>{w.unknown.orders} {w.unknown.orders === 1 ? 'order' : 'orders'} with unknown payment environment, excluded</small>}
                </div>)}</div>
                <p className={styles.muted}>Gross recorded amounts by order date include shipping and tax; this is not net revenue. Refunded, cancelled and failed orders are excluded; fulfillment holds still count. Orders marked as internal tests are excluded; remaining records are not confirmed customer sales. Today is partial from midnight in {data.timeZone}. The 7- and 30-day totals and custom comparison use complete dates in that time zone. Needs attention always shows current work.</p>
            </>}
        </>}
    </section>;
}
