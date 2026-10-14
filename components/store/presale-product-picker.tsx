'use client';

import { useState } from 'react';
import type { Product } from '@/lib/catalog';
import styles from './presale-product-picker.module.css';

/** Choose presale products by name. Submits the same comma-separated `productIds` field the presale form expects. */
export function PresaleProductPicker({ products }: { products: Product[] }) {
    const [chosen, setChosen] = useState<number[]>([]);
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const shown = products.filter(p => !needle || [p.name, p.sku, ...p.sizes].join(' ').toLowerCase().includes(needle));
    const toggle = (id: number) => setChosen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    return <fieldset className={styles.picker}>
        <legend>Products in this presale</legend>
        <input type="hidden" name="productIds" value={chosen.join(',')} required/>
        <input type="search" aria-label="Find a product for this presale" placeholder="Find a product" value={query} onChange={e => setQuery(e.target.value)}/>
        <div className={styles.list}>{shown.map(p => <label key={p.id} className={styles.option}>
            <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)}/><span>{p.name}<small>{p.sizes.join(' · ')}</small></span>
        </label>)}{!shown.length && <p className={styles.empty}>No product matches.</p>}</div>
        <p className={styles.summary} role="status">{chosen.length ? `${chosen.length} selected: ` + chosen.map(id => products.find(p => p.id === id)?.name).filter(Boolean).join(', ') : 'Choose at least one product.'}</p>
    </fieldset>;
}
