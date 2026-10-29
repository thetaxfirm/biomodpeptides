'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Contact } from '@/lib/contacts';
import { sourceLabels } from '@/lib/contacts';
import styles from './contacts-admin.module.css';

/** Everyone who has given the site an email or phone, newest first, with a CSV export. */
export function ContactsAdmin() {
 const [data, setData] = useState<{ contacts: Contact[]; total: number; withPhone: number } | null>(null), [error, setError] = useState(''), [q, setQ] = useState(''), [source, setSource] = useState(''), [phoneOnly, setPhoneOnly] = useState(false), [generation, setGeneration] = useState(0);
 useEffect(() => { let live = true; setError(''); fetch('/api/admin/contacts', { cache: 'no-store' }).then(async r => { const d = await r.json() as { contacts: Contact[]; total: number; withPhone: number; error?: string }; if (!r.ok) throw Error(d.error || 'Contacts could not be loaded.'); if (live) setData(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [generation]);
 const shown = useMemo(() => { const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, ''); return (data?.contacts || []).filter(c => (!source || c.sources.includes(source as Contact['sources'][number])) && (!phoneOnly || c.phones.length) && (!needle || c.email.includes(needle) || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phones.some(p => p.replace(/\D/g, '').includes(digits))))); }, [data, q, source, phoneOnly]);
 return <section aria-label="Contacts"><h2>Contacts</h2>
  <p>Every email and phone number visitors have given the site: accounts, orders, contact forms, stock alerts, COA requests and affiliates. Accounts are added when they sign up or next sign in. Anonymous browsing is not tied to anyone.</p>
  {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => setGeneration(g => g + 1)}>Try again</button></p>}
  {!data && !error && <p role="status">Loading contacts…</p>}
  {data && <><p><strong>{data.total}</strong> contacts · <strong>{data.withPhone}</strong> with a phone number · <a href="/api/admin/contacts?format=csv">Download CSV</a></p>
   <div className={'form-row ' + styles.filters}><label className="field">Search name, email or phone<input type="search" value={q} onChange={e => setQ(e.target.value)}/></label>
    <label className="field">Source<select value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option>{Object.entries(sourceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field"><span><input type="checkbox" checked={phoneOnly} onChange={e => setPhoneOnly(e.target.checked)}/> Has a phone number</span></label></div>
   <p role="status">Showing {shown.length}</p>
   <div style={{ overflowX: 'auto' }}><table className={styles.table}><thead><tr><th>Name and email</th><th>Phone</th><th>Source</th><th>Orders</th><th>Paid</th><th>Last seen</th></tr></thead>
    <tbody>{shown.slice(0, 500).map(c => <tr key={c.email}><td>{c.name || '—'}<br/><a href={'mailto:' + c.email}>{c.email}</a></td><td>{c.phones.map(p => <div key={p}><a href={'tel:' + p.replace(/[^\d+]/g, '')}>{p}</a></div>)}{!c.phones.length && '—'}</td><td>{c.sources.map(s => sourceLabels[s]).join(', ')}</td><td>{c.orders}</td><td>{c.paidCents ? '$' + (c.paidCents / 100).toFixed(2) : '—'}</td><td>{new Date(c.lastSeen).toLocaleDateString()}</td></tr>)}</tbody></table>
    {shown.length > 500 && <p>Showing the first 500. Narrow the search or download the CSV for all {shown.length}.</p>}</div></>}
 </section>;
}
