'use client';

import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/catalog';
import type { Attention, Overview } from '@/lib/admin-overview';
import { api } from './provider';
import styles from './admin-overview.module.css';

const tabNames: Record<string, string> = { orders: 'Orders', requests: 'Customer requests', products: 'Products', settings: 'Settings' };

function Item({ item, onOpen }: { item: Attention; onOpen: (tab: string) => void }) {
    return <li className={styles.item} data-tone={item.tone}>
        <span className={styles.count} aria-hidden="true">{item.count || '!'}</span>
        <div className={styles.text}><strong>{item.title}</strong><span>{item.detail}</span></div>
        <button type="button" className={styles.open} onClick={() => onOpen(item.tab)}>Open {tabNames[item.tab] || item.tab}</button>
    </li>;
}

/** The first screen of administration: what needs doing now, sales, and store setup gaps. */
export function AdminOverview({ onOpen, reloadToken = 0 }: { onOpen: (tab: string) => void; reloadToken?: number }) {
    const [data, setData] = useState<Overview | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const sequence = useRef(0);
    async function load() {
        const request = ++sequence.current;
        setLoading(true); setError('');
        try { const next = await api('admin-overview') as Overview; if (request === sequence.current) setData(next); }
        catch { if (request === sequence.current) setError('Today could not load. Retry, or open Orders directly.'); }
        finally { if (request === sequence.current) setLoading(false); }
    }
    useEffect(() => { void load(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(data?.generatedAt ?? Date.now());
    const work = data ? [...data.setup, ...data.attention] : [];
    return <section className={styles.overview} aria-labelledby="overview-title" aria-busy={loading}>
        <div className={styles.heading}>
            <div><h2 id="overview-title">Today</h2><p>{today}</p></div>
            <button type="button" className="text-button" disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : 'Refresh'}</button>
        </div>
        {error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => void load()}>Retry</button></div>}
        {!data && !error && <p className={styles.muted} role="status">Checking orders, requests and products…</p>}
        {data && <>
            <h3 className={styles.sectionTitle}>Needs attention</h3>
            {work.length ? <ul className={styles.list}>{work.map(item => <Item key={item.id} item={item} onOpen={onOpen}/>)}</ul>
                : <p className={styles.clear} role="status">Nothing is waiting. Every paid order is moving, no customer has waited over a day, and no product is holding up an order.</p>}
            {data.sales && <>
                <h3 className={styles.sectionTitle}>Sales</h3>
                <div className={styles.sales}>{data.sales.map(w => <div key={w.label} className={styles.figure}>
                    <span>{w.label}</span><strong>{money(w.revenue)}</strong><small>{w.orders} paid {w.orders === 1 ? 'order' : 'orders'}</small>
                </div>)}</div>
                <p className={styles.muted}>Paid orders by the day they were placed, including shipping and tax, before refunds. Internal tests are left out. Today runs from midnight Pacific time.</p>
            </>}
        </>}
    </section>;
}
