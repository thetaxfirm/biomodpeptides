'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { money } from '@/lib/catalog';
import type { CustomerPricePreview } from '@/lib/customer-price-preview';
type Choice = { id: number; name: string; sizes: string[] };
export function AdminPricePreview({ products: supplied }: { products?: Choice[] }) {
    const [products, setProducts] = useState(supplied || []);
    const [rows, setRows] = useState([{ id: '', quantity: '1' }]);
    const [mode, setMode] = useState('single'), [size, setSize] = useState('3'), [code, setCode] = useState('');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<CustomerPricePreview | null>(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (supplied) { setProducts(supplied); return; }
        let active = true;
        fetch('/api/admin/price-preview', { cache: 'no-store' }).then(async r => { const d = await r.json() as { products: Choice[]; error?: string }; if (!r.ok) throw Error(d.error); if (active) { setProducts(d.products); setError(''); } }).catch(e => { if (active) setError(e.message || 'Products could not load.'); });
        return () => { active = false; };
    }, [supplied, reload]);
    function changeRow(index: number, patch: Partial<typeof rows[number]>) { setResult(null); setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row)); }
    async function preview(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError(''); setResult(null);
        try {
            const selected = mode === 'fixed' ? rows.slice(0, 1) : rows;
            const lines = selected.map(row => ({ id: Number(row.id), quantity: mode === 'fixed' ? Number(size) : Number(row.quantity), ...(mode !== 'single' ? { packId: 'admin-preview', packSize: Number(size), packKind: mode } : {}) }));
            const response = await fetch('/api/admin/price-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines, code }) });
            const data = await response.json() as CustomerPricePreview & { error?: string }; if (!response.ok) throw Error(data.error); setResult(data);
        } catch (e) { setError(e instanceof Error ? e.message : 'The price could not be calculated.'); } finally { setBusy(false); }
    }
    return <details className="account-record"><summary>Preview customer pricing</summary><p>Uses saved products, current offers and checkout rules. Shipping, tax and reward redemption are calculated later in checkout.</p>
        <form className="store-form" onSubmit={preview} onChange={() => setResult(null)}><fieldset disabled={busy}><legend>Build a price preview</legend>
            <label className="field">Purchase type<select value={mode} onChange={e => setMode(e.target.value)}><option value="single">Single items</option><option value="fixed">Fixed pack</option><option value="mixed">Mix-and-match pack</option></select></label>
            {mode !== 'single' && <label className="field">Pack size<select value={size} onChange={e => setSize(e.target.value)}>{[3,5,10].map(n => <option key={n}>{n}</option>)}</select></label>}
            {(mode === 'fixed' ? rows.slice(0, 1) : rows).map((row, index) => <div className="form-row" key={index}><label className="field">Product {index + 1}<select required value={row.id} onChange={e => changeRow(index, { id: e.target.value })}><option value="">Choose a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sizes.join(' · ')}</option>)}</select></label>{mode !== 'fixed' && <label className="field">Quantity<input required type="number" min="1" max="100" value={row.quantity} onChange={e => changeRow(index, { quantity: e.target.value })}/></label>}{index > 0 && <button type="button" className="text-button" onClick={() => { setRows(rows.filter((_, i) => i !== index)); setResult(null); }}>Remove</button>}</div>)}
            {mode !== 'fixed' && <button type="button" className="text-button" onClick={() => { setRows([...rows, { id: '', quantity: '1' }]); setResult(null); }}>Add another product</button>}
            <label className="field">Promo code (optional)<input value={code} onChange={e => setCode(e.target.value)} maxLength={40}/></label><button className="button button-dark" disabled={!products.length}>Calculate price</button>
        </fieldset></form>
        {error && <p role="alert">{error} {!products.length && <button className="text-button" onClick={() => setReload(reload + 1)}>Retry products</button>}</p>}
        {result && <div role="status"><ul>{result.items.map((item, i) => <li key={i}>{item.name} × {item.quantity}: {money(item.total)}. {item.offer}, {money(item.currentUnit)} per item before pack and promo savings{item.baseUnit !== item.currentUnit ? ` (base ${money(item.baseUnit)})` : ''}.</li>)}</ul><p>After current offers: {money(result.subtotal)} · Pack savings: {money(result.packDiscount)} · Promo savings: {money(result.promoDiscount)}</p><p><strong>Product total: {money(result.total)}</strong></p>{result.attribution && <p>{result.promo?.code}: {result.attribution.label} ({result.attribution.kind}). {result.attribution.note}</p>}</div>}
    </details>;
}
