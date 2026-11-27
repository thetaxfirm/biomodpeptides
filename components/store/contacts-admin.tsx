'use client';
import { useEffect, useMemo, useState } from 'react';
import type { SharedContact as Contact, CrmSite } from '@/lib/shared-crm';
import { siteLabels } from '@/lib/shared-crm';
import { sourceLabels } from '@/lib/contacts';
import styles from './contacts-admin.module.css';
import { CustomerWorkspace } from './customer-workspace';

/** Everyone who has given the site an email or phone, newest first, with a CSV export. */
export function ContactsAdmin() {
 const [selected,setSelected]=useState<string|null>(null),[page,setPage]=useState(0);
 const [data, setData] = useState<{ contacts: Contact[]; shared?: boolean; syncHealth?: { status: string; lastSuccessAt: number | null }; total: number; withPhone: number; textSignups?: { phone: string; signedUp: number; delivery: string; sends: number }[]; emailSignups?: { email: string; signedUp: number; page: string; unsubscribed: number | null }[] } | null>(null), [store, setStore] = useState<'' | CrmSite | 'both'>(''), [error, setError] = useState(''), [q, setQ] = useState(''), [source, setSource] = useState(''), [phoneOnly, setPhoneOnly] = useState(false), [generation, setGeneration] = useState(0);
 useEffect(() => { let live = true; setError(''); fetch('/api/admin/contacts', { cache: 'no-store' }).then(async r => { const d = await r.json() as { contacts: Contact[]; shared?: boolean; syncHealth?: { status: string; lastSuccessAt: number | null }; total: number; withPhone: number; error?: string }; if (!r.ok) throw Error(d.error || 'Contacts could not be loaded.'); if (live) setData(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [generation]);
 const shown = useMemo(() => { const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, ''); return (data?.contacts || []).filter(c => (!store || (store === 'both' ? c.stores.length > 1 : c.stores.some(x => x.site === store))) && (!source || c.sources.includes(source as Contact['sources'][number])) && (!phoneOnly || c.phones.length) && (!needle || c.email.includes(needle) || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phones.some(p => p.replace(/\D/g, '').includes(digits))))); }, [data, q, source, phoneOnly, store]);
 useEffect(()=>setPage(0),[q,source,phoneOnly,store]);
 return <section aria-label="Contacts"><h2>Contacts</h2>
  <p>One list for TryBiomod and Biomod Pro: every email and phone number visitors have given either store, matched by email. Accounts, orders, contact forms, stock alerts, COA requests and affiliates. Accounts are added when they sign up or next sign in. Anonymous browsing is not tied to anyone.</p>
  {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => setGeneration(g => g + 1)}>Try again</button></p>}
  {!data && !error && <p role="status">Loading contacts…</p>}
  {data && <>{data.shared === false && <p role="status">Showing this store only: the shared list could not be reached.</p>}<p role="status">Shared contact sync: {data.syncHealth?.status.replaceAll('_', ' ') || 'not checked'}{data.syncHealth?.lastSuccessAt ? ' · Last complete sync ' + new Date(data.syncHealth.lastSuccessAt).toLocaleString() : ''}.</p><p><strong>{data.total}</strong> contacts · <strong>{data.withPhone}</strong> with a phone number · <a href="/api/admin/contacts?format=csv">Download CSV</a></p>
   <div className={'form-row ' + styles.filters}><label className="field">Search name, email or phone<input type="search" value={q} onChange={e => setQ(e.target.value)}/></label>
    <label className="field">Store<select value={store} onChange={e => setStore(e.target.value as typeof store)}><option value="">Both stores</option>{(Object.keys(siteLabels) as CrmSite[]).map(k => <option key={k} value={k}>{siteLabels[k]}</option>)}<option value="both">Customers of both</option></select></label>
    <label className="field">Source<select value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option>{Object.entries(sourceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field"><span><input type="checkbox" checked={phoneOnly} onChange={e => setPhoneOnly(e.target.checked)}/> Has a phone number</span></label></div>
   <p role="status">{shown.length} matching contacts.</p>{selected&&<CustomerWorkspace key={selected} email={selected} onClose={()=>setSelected(null)}/>}
   <div style={{ overflowX: 'auto' }}><table className={styles.table}><thead><tr><th>Name and email</th><th>Store</th><th>Phone</th><th>Source</th><th>Orders</th><th>Paid</th><th>Last seen</th></tr></thead>
    <tbody>{shown.slice(page*50, page*50+50).map(c => <tr key={c.email}><td><button type="button" className="text-button" onClick={()=>setSelected(c.email)}>{c.name||c.email}</button><br/><a href={'mailto:' + c.email}>{c.email}</a></td><td>{c.stores.map(x => <div key={x.site}>{siteLabels[x.site]}{x.orders ? ' · ' + x.orders + (x.orders === 1 ? ' order' : ' orders') : ''}</div>)}</td><td>{c.phones.map(p => <div key={p}><a href={'tel:' + p.replace(/[^\d+]/g, '')}>{p}</a></div>)}{!c.phones.length && '—'}</td><td>{c.sources.map(s => sourceLabels[s]).join(', ')}</td><td>{c.orders}</td><td>{c.paidCents ? '$' + (c.paidCents / 100).toFixed(2) : '—'}</td><td>{new Date(c.lastSeen).toLocaleDateString()}</td></tr>)}</tbody></table>
    {shown.length>50&&<div className={styles.paging}><button type="button" className="text-button" disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous contacts</button><span>Page {page+1} of {Math.ceil(shown.length/50)}</span><button type="button" className="text-button" disabled={(page+1)*50>=shown.length} onClick={()=>setPage(n=>n+1)}>Next contacts</button></div>}</div>
   <h3>Text sign-ups</h3>
   <p>Phone numbers from the 10% text offer on the cart page. Each person agreed to marketing texts when they pressed the button. {data.textSignups?.length ? <><strong>{data.textSignups.length}</strong> so far · <a href="/api/admin/contacts?format=text-csv">Download CSV</a></> : 'None yet.'}</p>
   {Boolean(data.textSignups?.length) && <div style={{ overflowX: 'auto' }}><table className={styles.table}><thead><tr><th>Phone</th><th>Signed up</th><th>Code delivery</th></tr></thead>
    <tbody>{data.textSignups!.slice(0, 500).map(t => <tr key={t.phone}><td><a href={'tel:' + t.phone}>{t.phone}</a></td><td>{new Date(t.signedUp).toLocaleDateString()}</td><td>{t.delivery}</td></tr>)}</tbody></table></div>}
   <h3>Email sign-ups</h3>
   <p>Emails from the 10% sign-up panel shown to visitors who are not signed in. Each person agreed to sale emails. {data.emailSignups?.length ? <><strong>{data.emailSignups.filter(e => !e.unsubscribed).length}</strong> subscribed{data.emailSignups.some(e => e.unsubscribed) ? ' · ' + data.emailSignups.filter(e => e.unsubscribed).length + ' unsubscribed' : ''} · <a href="/api/admin/contacts?format=email-csv">Download CSV</a></> : 'None yet.'}</p>
   {Boolean(data.emailSignups?.length) && <div style={{ overflowX: 'auto' }}><table className={styles.table}><thead><tr><th>Email</th><th>Signed up</th><th>Page</th><th>Status</th></tr></thead>
    <tbody>{data.emailSignups!.slice(0, 500).map(e => <tr key={e.email}><td><a href={'mailto:' + e.email}>{e.email}</a></td><td>{new Date(e.signedUp).toLocaleDateString()}</td><td>{e.page}</td><td>{e.unsubscribed ? 'Unsubscribed' : 'Subscribed'}</td></tr>)}</tbody></table></div>}</>}
 </section>;
}
