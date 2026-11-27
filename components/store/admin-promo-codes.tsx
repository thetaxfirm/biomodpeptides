'use client';
import { AdminPricePreview } from './admin-price-preview';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { PromoOwner } from '@/lib/promo-ownership';
import styles from './admin-promo-codes.module.css';

type Promo = { code: string; percentOff: number; active: boolean; created: number; by: string; expiresAt?: number | null; reason?: string; builtIn?: boolean };
type Report = { custom: Promo[]; builtIn: Promo[]; owners: Record<string, PromoOwner>; owner: boolean; versions: { manual: string; builtin: string }; maxPercentOff: number };
async function call(body?: Record<string, unknown>) {
    const r = await fetch('/api/admin/promo-codes', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const d = await r.json().catch(() => ({})) as Report & { error?: string; message?: string };
    if (!r.ok) throw Object.assign(new Error(d.error || 'Promo codes could not load.'), { status: r.status });
    return d;
}
const localDate = (ms?: number | null) => ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
const blank = { code: '', percent: '', active: true, expires: '', reason: '' };
export function AdminPromoCodes() {
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [denied, setDenied] = useState(false);
    const [editing, setEditing] = useState<Promo | 'new' | null>(null);
    const [draft, setDraft] = useState(blank);
    const [working, setWorking] = useState(false);
    async function load() {
        setLoading(true); setError('');
        try { setData(await call()); setDenied(false); }
        catch (e) { if ((e as {status?: number}).status === 403) setDenied(true); else setError(e instanceof Error ? e.message : 'Promo codes could not load.'); }
        finally { setLoading(false); }
    }
    useEffect(() => { void load(); }, []);
    function edit(row: Promo | 'new') {
        setEditing(row); setError('');
        setDraft(row === 'new' ? blank : { code: row.code, percent: String(row.percentOff), active: row.active, expires: localDate(row.expiresAt), reason: '' });
    }
    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (!data || !editing || working) return;
        const builtIn = editing !== 'new' && editing.builtIn;
        setWorking(true); setError('');
        try {
            const result = await call({ code: draft.code.trim().toUpperCase(), percentOff: Number(draft.percent), active: draft.active, expiresAt: draft.expires ? Date.parse(draft.expires) : null, reason: draft.reason, version: builtIn ? data.versions.builtin : data.versions.manual });
            toast.success(result.message || 'Code saved.'); setEditing(null); await load();
        } catch (e) { setError(e instanceof Error ? e.message : 'The code could not save.'); }
        finally { setWorking(false); }
    }
    if (denied) return null;
    const rows = data ? [...data.custom, ...data.builtIn.map(row => ({ ...row, builtIn: true }))] : [];
    return <section className={'account-record ' + styles.panel} aria-labelledby="promo-codes-title">
        <h2 id="promo-codes-title">Promo codes</h2>
        <p>Codes apply after sale and pack prices. Business and affiliate codes are managed with their owning agreement or business. An owner can change built-in codes with a recorded reason. Existing order prices stay unchanged.</p>
        {error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="text-button" disabled={loading || working || Boolean(editing)} onClick={() => void load()}>Retry loading promo codes</button>{editing && <p>Your draft is retained. Cancel it before reloading newer settings.</p>}</div>}
        {loading && !data && <p role="status">Loading promo codes…</p>}
        {!editing && <button type="button" className="button button-dark" disabled={!data || loading || working} onClick={() => edit('new')}>Add a promo code</button>}
        {editing && <form className="store-form" onSubmit={save}>
            <h3>{editing === 'new' ? 'New code' : 'Edit ' + editing.code}</h3>
            <div className="form-row">
                <label className="field">Code<input value={draft.code} readOnly={editing !== 'new'} required minLength={3} maxLength={40} pattern="[A-Za-z0-9]{3,40}" disabled={working} onChange={e => setDraft(d => ({...d,code:e.target.value.toUpperCase()}))}/></label>
                <label className="field">Discount (%)<input type="number" min={1} max={data?.maxPercentOff || 90} step={1} value={draft.percent} required disabled={working} onChange={e => setDraft(d => ({...d,percent:e.target.value}))}/></label>
                <label className="field">Expires (local time, optional)<input type="datetime-local" value={draft.expires} disabled={working} onChange={e => setDraft(d => ({...d,expires:e.target.value}))}/></label>
            </div>
            <label><input type="checkbox" checked={draft.active} disabled={working} onChange={e => setDraft(d => ({...d,active:e.target.checked}))}/> Active for new orders</label>
            <label className="field">Reason for change<textarea value={draft.reason} required minLength={8} maxLength={500} disabled={working} onChange={e => setDraft(d => ({...d,reason:e.target.value}))}/></label>
            <p>Clear Active to retire this code. Expiry stops new uses automatically. Historical orders retain their original discount.</p>
            <div className={styles.actions}><button className="button button-dark" disabled={working}>{working ? 'Saving…' : 'Save code'}</button><button type="button" className="text-button" disabled={working} onClick={() => setEditing(null)}>Cancel</button></div>
        </form>}
        {data && <ul className={styles.list}>{rows.map(row => {
            const owner = data.owners[row.code];
            const expired = row.expiresAt != null && row.expiresAt <= Date.now();
            const canEdit = !owner && (!row.builtIn || data.owner);
            return <li key={row.code}>
                <strong className={styles.code}>{row.code}</strong>
                <span className={styles.meta}>{row.percentOff}% off · {!row.active ? 'Retired' : expired ? 'Expired' : 'Active'} · {owner ? owner.label : row.builtIn ? 'Built-in' : 'Manual'}{row.expiresAt ? ' · expires ' + new Date(row.expiresAt).toLocaleString() : ''}</span>
                {owner ? <a href={owner.href}>Manage {owner.kind === 'business' ? 'business' : 'affiliate terms'}</a> : canEdit ? <button type="button" className="text-button" disabled={working || Boolean(editing)} onClick={() => edit(row)}>Edit</button> : <span>Owner-managed</span>}
            </li>;
        })}</ul>}
    <AdminPricePreview/></section>;
}
