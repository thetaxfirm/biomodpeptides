'use client';
import { useId, useState } from 'react';
import { Plus, X, Search, ChevronDown } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { compound, money } from '@/lib/catalog';
import { ProductImage } from './product-image';
import { packSizes, supportsPacks, packContents, packUnitLimit } from '@/lib/packs';
import { useStore, report } from './provider';
import { SavedPackTools } from './saved-packs';
import { Blank, Choice } from './primitives';

const formats = [
  { id: 'research-compounds', name: 'Research Compounds', unit: 'vials' },
  { id: 'softgels', name: 'Softgels', unit: 'bottles' },
  { id: 'spray-products', name: 'Nasal sprays', unit: 'bottles' },
];

export function PackBuilder({ initialSize = 3 }: { initialSize?: number }) {
  const { store, addMixedPack, ready } = useStore();
  const [count, setCount] = useState(packSizes.includes(initialSize as any) ? initialSize : 3);
  const [selected, setSelected] = useState<number[]>([]);
  const [savedId, setSavedId] = useState<string>();
  const [q, setQ] = useState('');
  const [format, setFormat] = useState('all');
  const [sort, setSort] = useState('name');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const eligible = store.products.filter(p => supportsPacks(p) && p.inStock && p.purchasable);
  const visible = eligible.filter(p => (format === 'all' || p.categories.some(c => c.slug === format)) &&
    `${p.name} ${compound(p)} ${packContents(p)}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => sort === 'price-up' ? a.price - b.price : sort === 'price-down' ? b.price - a.price : a.name.localeCompare(b.name));
  const total = selected.reduce((sum, id) => sum + (store.products.find(p => p.id === id)?.price || 0), 0);
  const percent = store.config.packDiscounts[count] || 0;
  const savings = Math.round(total * percent / 100);
  const invalidIds = new Set(selected.filter(id => {
    const product = store.products.find(p => p.id === id);
    const quantity = selected.filter(value => value === id).length + store.cart.filter(line => line.id === id).reduce((sum, line) => sum + line.quantity, 0);
    return !product || !product.inStock || !product.purchasable || !supportsPacks(product) || quantity > packUnitLimit(product);
  }));
  const complete = selected.length === count && invalidIds.size === 0;
  const addPack = async () => {
    setBusy(true);
    try { await addMixedPack(selected); setSelected([]); setSavedId(undefined); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  };

  return <section className="pack-studio">
    <header className="pack-intro"><div><h1>Build your pack.</h1><p>Choose your size. Mix vials and bottles, or add multiples of one product.</p></div><a href="#pack-products">Browse products <ChevronDown size={18}/></a></header>
    <RadioGroup className="pack-size-bar" aria-label="Pack size" value={String(count)} onValueChange={value => { const next = Number(value); setCount(next); setSelected(items => items.slice(0, next)); }}>
      {packSizes.map(n => <label className="pack-size-tile" data-selected={n === count} htmlFor={groupId + n} key={n}>
        <RadioGroupItem id={groupId + n} value={String(n)} disabled={busy}/><strong>{n}</strong><span>{n === 1 ? 'Single product' : 'Product pack'}<small>{n > 1 && store.config.packDiscounts[n] ? `Save ${store.config.packDiscounts[n]}%` : 'Your choice'}</small></span>
      </label>)}
    </RadioGroup>
    <SavedPackTools selectionBusy={busy} count={count} selected={selected} savedId={savedId} onLoad={pack => { setCount(pack.products.length); setSelected(pack.products); setSavedId(pack.id); setQ(''); setFormat('all'); setReviewOpen(true); }} onSaved={setSavedId}/>
    <div className="pack-workspace">
      <aside className="pack-review" id="pack-review" aria-label="Your pack">
        <div className="pack-review-heading"><h2>Your {count === 1 ? 'selection' : count + '-pack'}</h2>{selected.length > 0 && <button className="text-button" disabled={busy} onClick={() => { setSelected([]); setSavedId(undefined); }}>Clear</button>}</div>
        <p className="pack-progress-copy" aria-live="polite">{invalidIds.size ? 'Review unavailable quantities.' : complete ? 'Your pack is ready.' : `Choose ${count - selected.length} more ${count - selected.length === 1 ? 'product' : 'products'}.`}<strong>{selected.length} / {count}</strong></p>
        <div className="pack-progress-track" aria-hidden="true">{Array.from({ length: count }, (_, i) => <span key={i} data-filled={i < selected.length}/>)}</div>
        <Collapsible open={reviewOpen} onOpenChange={setReviewOpen}>
          <CollapsibleTrigger className="pack-review-toggle">{reviewOpen ? 'Hide products' : 'Review products'}<ChevronDown size={17}/></CollapsibleTrigger>
          <CollapsibleContent forceMount className="pack-review-content">
            <ol className="pack-selected-products" aria-label="Selected pack products">
              {selected.map((id, i) => { const p = store.products.find(p => p.id === id); return <li key={i}><span className="pack-position">{i + 1}</span>{p ? <ProductImage product={p} alt="" width={62} height={72}/> : <span/>}<div><strong>{p?.name || 'Unavailable product'}</strong><small>{invalidIds.has(id) ? 'Remove or reduce this quantity' : p ? packContents(p) : ''}</small></div><button className="icon-button" aria-label={'Remove ' + (p?.name || 'unavailable product') + ' from slot ' + (i + 1)} disabled={busy} onClick={() => setSelected(items => items.filter((_, index) => index !== i))}><X size={16}/></button></li>; })}
            </ol>
            {!selected.length && <p className="pack-empty">Your products will appear here as you add them.</p>}
          </CollapsibleContent>
        </Collapsible>
        <dl className="pack-price-summary"><div><dt>Single prices</dt><dd>{money(total)}</dd></div>{percent > 0 && <div><dt>Pack savings · {percent}%</dt><dd>−{money(savings)}</dd></div>}<div className="pack-final-price"><dt>Pack total</dt><dd aria-live="polite">{money(total - savings)}</dd></div></dl>
        <button className="button pack-add-button" disabled={!complete || busy || !ready} onClick={addPack}>{busy ? 'Adding…' : complete ? (count === 1 ? 'Add product to cart' : 'Add ' + count + '-pack to cart') : 'Complete your pack'}<Plus size={17}/></button>
        <p className="pack-shipping-note">Shipping and tax calculated at checkout.</p>
      </aside>
      <div className="pack-catalog" id="pack-products">
        <div className="pack-catalog-tools"><div className="pack-search-field"><Search size={19}/><input aria-label="Search pack products" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or compound"/></div><Choice label="Sort pack products" value={sort} onChange={setSort} options={[["name", "Name: A–Z"], ["price-up", "Price: low to high"], ["price-down", "Price: high to low"]]}/></div>
        <div className="pack-format-tabs" aria-label="Pack product format"><button aria-pressed={format === 'all'} onClick={() => setFormat('all')}>All products <span>{eligible.length}</span></button>{formats.map(f => <button key={f.id} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>{f.name}<span>{eligible.filter(p => p.categories.some(c => c.slug === f.id)).length}</span></button>)}</div>
        <p className="pack-result-count" aria-live="polite">{visible.length} {visible.length === 1 ? 'product' : 'products'}{q.trim() ? ` matching “${q.trim()}”` : ' available'}</p>
        {formats.map(f => { const items = visible.filter(p => p.categories.some(c => c.slug === f.id)); return items.length > 0 && <section className="pack-format-group" key={f.id}><div className="pack-group-heading"><h2>{f.name}</h2><span>{items.length} products · Full {f.unit}</span></div><div className="pack-product-grid">{items.map(p => {
          const used = selected.filter(id => id === p.id).length;
          const remaining = packUnitLimit(p) - used - store.cart.filter(line => line.id === p.id).reduce((sum, line) => sum + line.quantity, 0);
          return <article className="pack-product-card" data-selected={used > 0} key={p.id}>
            <a href={'/product/' + p.slug} className="pack-product-image" data-format={f.id} aria-label={'View ' + p.name}><ProductImage product={p} alt={p.name + (f.id === 'softgels' ? ' bottle' : '')}/></a>
            <div className="pack-product-copy"><h3><a href={'/product/' + p.slug}>{p.name}</a></h3><p className="pack-product-identity">{compound(p)}</p><p className="pack-product-contents">{packContents(p)}</p><div className="pack-product-price"><strong>{money(p.price - Math.round(p.price * percent / 100))}</strong>{percent > 0 && <del>{money(p.price)}</del>}</div><button className="pack-product-add" disabled={selected.length >= count || remaining <= 0 || busy || !ready} onClick={() => setSelected(items => [...items, p.id])} aria-label={'Add ' + p.name + ' to pack'}><span>{remaining <= 0 ? 'Limit reached' : selected.length >= count ? (used ? used + ' in your pack' : 'Pack complete') : used ? 'Add another · ' + used + ' in pack' : 'Add to pack'}</span><Plus size={16}/></button></div>
          </article>;
        })}</div></section>; })}
        {!visible.length && <Blank title="No products found."><p>Try another name or format.</p><button className="text-button" onClick={() => { setQ(''); setFormat('all'); }}>Clear search and filters</button></Blank>}
      </div>
    </div>
    <div className="pack-mobile-summary"><a href="#pack-review" onClick={() => setReviewOpen(true)}><span>{selected.length} of {count} selected</span><strong>{money(total - savings)}</strong></a><button className="button pack-add-button" disabled={!complete || busy || !ready} onClick={addPack}>{busy ? 'Adding…' : 'Add to cart'}</button></div>
  </section>;
}
