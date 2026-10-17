'use client';
import { hasCoa } from '@/lib/coa-shipping';

import { useState, type FormEvent } from 'react';
import { money, type Product } from '@/lib/catalog';
import { standardPackPrices, supportsPacks } from '@/lib/packs';
import { hasPublicationHold, blockedReleaseLot, productAvailability, productAvailabilityLabel, type ProductAvailability } from '@/lib/availability';
import { applySale } from '@/lib/sales';
import styles from './admin-products.module.css';

const groups = [
    { id: 'research-compounds', label: 'Lyophilized', description: 'Research vials', color: 'vials' },
    { id: 'spray-products', label: 'Sprays', description: 'Spray bottles', color: 'sprays' },
    { id: 'softgels', label: 'Softgels', description: 'Softgel bottles', color: 'softgels' },
    { id: 'other', label: 'Other products', description: 'Remaining catalog items', color: 'other' },
];
const states: { value: ProductAvailability; label: string; description: string }[] = [
    { value: 'available', label: 'Available', description: 'Accept orders while verified stock is available.' },
    { value: 'coming_soon', label: 'Coming soon', description: 'Show the product, with ordering disabled.' },
    { value: 'sold_out', label: 'Sold out', description: 'Show sold out and stop new orders.' },
    { value: 'unavailable', label: 'Unavailable', description: 'Keep ordering disabled until reviewed.' },
];
const groupFor = (p: Product) => groups.find(g => p.categories.some(c => c.slug === g.id)) || groups[3];
function localDate(value?: string) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date not set';
function offerLabel(p: Product, now = Date.now()) {
    if (productAvailability(p) !== 'available') {
        if (p.preorder?.enabled) return `Preorder configured · ${p.preorder.percentOff}% off`;
        if (p.sale?.enabled) return `Sale configured · ${p.sale.percentOff}% off`;
    }
    if (p.preorder?.enabled) return `Preorder · ${p.preorder.percentOff}% off`;
    if (!p.sale?.enabled) return 'No active offer';
    if (Date.parse(p.sale.ends) <= now) return 'Sale ended';
    if (Date.parse(p.sale.starts) > now) return `Scheduled · ${p.sale.percentOff}% off`;
    return `Sale · ${p.sale.percentOff}% off`;
}

type BatchChoice = { ref: string; lot: string | null; reportId: string; filename: string; url?: string; strength: string; productName: string; eligible: boolean; identityEligible?: boolean; reason?: string };
type BatchRecord = { productId: number; lot: string | null; reportRef: string | null; coaAvailable: boolean; attached: BatchChoice | null; choices: BatchChoice[] };

type Props = {
    batchRecords?: BatchRecord[];
    canRelease?: boolean;
    products: Product[];
    edited: Product | null;
    query: string;
    busy: boolean;
    formKey: number;
    onQuery: (value: string) => void;
    onEdit: (product: Product) => void;
    onCancel: () => void;
    onDraft: () => void;
    onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

// Quick views of products that need the owner's attention. COA uses the same rule as the shipping block.
const issues = [
    { id: 'no_coa', label: 'No COA', test: (p: Product) => !hasCoa(p) },
    { id: 'stock_unset', label: 'Stock not entered', test: (p: Product) => p.stockQuantity == null },
    { id: 'low', label: 'Low stock (5 or fewer)', test: (p: Product) => p.stockQuantity != null && p.stockQuantity > 0 && p.stockQuantity <= 5 },
    { id: 'out', label: 'Out of stock', test: (p: Product) => p.stockQuantity != null && p.stockQuantity <= 0 },
] as const;
export function AdminProducts(props: Props) {
    const [format, setFormat] = useState('all');
    const [issue, setIssue] = useState<string | null>(null);
    const { products, edited, query, busy, onQuery, onEdit, batchRecords = [] } = props;
    if (edited) return <ProductEditor key={`${props.formKey}:${edited.id}`} {...props} product={edited}/>;
    const needle = query.trim().toLowerCase();
    const issueTest = issues.find(i => i.id === issue)?.test;
    const matched = products.filter(p => [p.name, p.sku, ...p.sizes].join(' ').toLowerCase().includes(needle) && (!issueTest || issueTest(p)));
    const shownGroups = groups.filter(g => (format === 'all' || format === g.id) && matched.some(p => groupFor(p).id === g.id));
    return <section className={styles.products} aria-labelledby="admin-products-title">
        <div className={styles.heading}><div><h2 id="admin-products-title">Products</h2><p>Set availability, prices and timed offers for each product.</p></div>
            <label className={styles.search}><span>Find a product</span><input type="search" aria-label="Find a product to edit" placeholder="Name, size or SKU" value={query} onChange={e => onQuery(e.target.value)}/></label>
        </div>
        <div className={styles.filters} aria-label="Filter products by format">
            <button type="button" aria-pressed={format === 'all'} onClick={() => setFormat('all')}>All products <span>{products.length}</span></button>
            {groups.filter(g => products.some(p => groupFor(p).id === g.id)).map(g => <button key={g.id} type="button" className={styles[g.color]} aria-pressed={format === g.id} onClick={() => setFormat(g.id)}>{g.label} <span>{products.filter(p => groupFor(p).id === g.id).length}</span></button>)}
        </div>
        <div className={styles.filters} aria-label="Show products that need attention">
            <span className={styles.filterLabel}>Needs attention</span>
            {issues.map(i => { const n = products.filter(i.test).length; return <button key={i.id} type="button" aria-pressed={issue === i.id} disabled={!n && issue !== i.id} onClick={() => setIssue(issue === i.id ? null : i.id)}>{i.label} <span>{n}</span></button>; })}
        </div>
        {shownGroups.map(g => <section className={`${styles.group} ${styles[g.color]}`} key={g.id} aria-labelledby={`product-group-${g.id}`}>
            <header className={styles.groupHeading}><div><h3 id={`product-group-${g.id}`}>{g.label}</h3><p>{g.description}</p></div><span>{matched.filter(p => groupFor(p).id === g.id).length} products</span></header>
            <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr><th scope="col">Product</th><th scope="col">Base price</th><th scope="col">Availability</th><th scope="col">Offer</th><th scope="col">Verified stock</th><th scope="col"><span className={styles.srOnly}>Action</span></th></tr></thead>
                <tbody>{matched.filter(p => groupFor(p).id === g.id).map(p => {
                    const effective = productAvailability(p), priced = applySale(p), batch = batchRecords.find(record => record.productId === p.id);
                    return <tr key={p.id}><th scope="row"><strong>{p.name}</strong><small>{p.sizes.join(' · ')}{p.sku ? ` · ${p.sku}` : ''}</small>{batch && <small>Lot {batch.lot || 'not listed'} · {hasCoa(p) ? 'COA on file' : <span className={styles.noCoa}>No COA, can't ship</span>}</small>}</th>
                        <td data-label="Base price"><strong>{money(p.price)}</strong>{priced.price !== p.price && <small>{money(priced.price)} with offer</small>}</td>
                        <td data-label="Availability"><span className={styles[effective]}>{effective === 'available' && p.preorder?.enabled ? 'Preorder' : productAvailabilityLabel(p)}</span></td>
                        <td data-label="Offer"><span className={p.preorder?.enabled || p.sale?.enabled ? styles.offer : undefined}>{offerLabel(p)}</span>{p.preorder?.enabled ? <small>{effective !== 'available' ? 'Ordering closed · ' : ''}{p.preorder.ships}</small> : p.sale?.enabled && <small>{effective !== 'available' ? 'Ordering closed · ' : ''}{Date.parse(p.sale.starts) > Date.now() ? 'Starts ' + dateLabel(p.sale.starts) : 'Ends ' + dateLabel(p.sale.ends)}</small>}</td>
                        <td data-label="Verified stock">{p.stockQuantity == null ? 'Not set' : p.stockQuantity}</td>
                        <td><button type="button" className={styles.editButton} disabled={busy} aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)}>Edit</button></td></tr>;
                })}</tbody>
            </table></div>
        </section>)}
        {!shownGroups.length && <p className={styles.empty} role="status">{issue ? 'No products match this view. Choose the view again to clear it.' : 'No products match this search and format. Try another name or choose All products.'}</p>}
        <p className={styles.footnote}>Base prices are before preorder, sale, pack and promo discounts. Existing orders keep their saved prices and fulfillment terms.</p>
    </section>;
}

function ProductEditor({ product: p, busy, onEdit, onCancel, onDraft, onSave, batchRecords = [], canRelease = false }: Props & { product: Product }) {
    const batch = batchRecords.find(record => record.productId === p.id);
    const [batchDraft, setBatchDraft] = useState(() => ({ lot: batch?.lot || '', reportRef: batch?.reportRef || '', coaAvailable: Boolean(batch?.coaAvailable) }));
    const [releaseReviewed, setReleaseReviewed] = useState(false);
    const [releaseReason, setReleaseReason] = useState('');
    const reportChoices = batch?.choices || [];
    const attached = reportChoices.find(choice => choice.ref === batchDraft.reportRef) || (batch?.attached?.ref === batchDraft.reportRef ? batch.attached : null);
    const exactReport = Boolean((attached?.identityEligible ?? attached?.eligible) && attached?.lot && attached.lot.trim() === batchDraft.lot.trim());
    const failedLot = blockedReleaseLot(p, batchDraft.lot.trim() || null);
    const batchChanged = batchDraft.lot !== (batch?.lot || '') || batchDraft.reportRef !== (batch?.reportRef || '') || batchDraft.coaAvailable !== Boolean(batch?.coaAvailable);
    function changeLot(lot: string) { if (busy) return; setBatchDraft({ lot, reportRef: '', coaAvailable: false }); setReleaseReviewed(false); setError(''); onDraft(); }
    function changeReport(ref: string) { if (busy) return; setBatchDraft(previous => ({ ...previous, reportRef: ref, coaAvailable: false })); setError(''); onDraft(); }
    const [draft, setDraft] = useState(() => ({
        price: String(p.price / 100), fixed3: p.packPrices?.[3] == null ? '' : String(p.packPrices[3] / 100), fixed5: p.packPrices?.[5] == null ? '' : String(p.packPrices[5] / 100), fixed10: p.packPrices?.[10] == null ? '' : String(p.packPrices[10] / 100),
        preorderPercent: p.preorder?.percentOff?.toString() || '', preorderShips: p.preorder?.ships || '',
        salePercent: p.sale?.percentOff?.toString() || '', saleStarts: localDate(p.sale?.starts), saleEnds: localDate(p.sale?.ends),
        stockQuantity: p.stockQuantity?.toString() ?? '', maxQuantity: String(p.maxQuantity ?? 100),
    }));
    const [packPricingMode, setPackPricingMode] = useState<'automatic' | 'custom'>('custom');
    const [error, setError] = useState('');
    const batchProduct = { ...p, batch: { lot: batchDraft.lot.trim() || null, reportRef: batchDraft.reportRef || null, coaAvailable: batchDraft.coaAvailable } };
    const group = groupFor(p), held = hasPublicationHold(batchProduct), selected = p.availability || productAvailability(p);
    const saleEnabled = Boolean(p.sale?.enabled), preorderEnabled = Boolean(p.preorder?.enabled);
    const baseCents = Math.round(Number(draft.price) * 100), percent = Number(draft.salePercent);
    const validPrice = Number.isFinite(baseCents) && baseCents > 0;
    const validPercent = Number.isFinite(percent) && percent > 0 && percent < 100;
    const discounted = validPrice && validPercent ? Math.max(1, Math.round(baseCents * (100 - percent) / 100)) : null;
    const duration = (Date.parse(draft.saleEnds) - Date.parse(draft.saleStarts)) / 3600000;
    const durationDays = Number((duration / 24).toFixed(2)), durationHours = Number(duration.toFixed(2));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'device time zone';
    function field(name: keyof typeof draft, value: string) {
        if (busy) return;
        if (name === 'price') {
            const amount = Number(value), cents = Math.round(amount * 100);
            const completePrice = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value) && amount > 0 && amount <= 99999.99;
            const packs = completePrice ? standardPackPrices(cents) : null;
            setDraft(previous => ({ ...previous, price: value, fixed3: packs ? (packs[3] / 100).toFixed(2) : '', fixed5: packs ? (packs[5] / 100).toFixed(2) : '', fixed10: packs ? (packs[10] / 100).toFixed(2) : '' }));
            setPackPricingMode('automatic');
        } else {
            setDraft(previous => ({ ...previous, [name]: value }));
            if (name === 'fixed3' || name === 'fixed5' || name === 'fixed10') setPackPricingMode('custom');
        }
        setError(''); onDraft();
    }
    function status(value: ProductAvailability) {
        if (busy) return;
        onEdit({ ...p, availability: value, inStock: value === 'available', purchasable: value === 'available' });
    }
    function saleDuration(hours: number) {
        if (busy) return;
        const starts = Number.isFinite(Date.parse(draft.saleStarts)) ? Date.parse(draft.saleStarts) : Math.floor(Date.now() / 60000) * 60000;
        setDraft(previous => ({ ...previous, saleStarts: localDate(new Date(starts).toISOString()), saleEnds: localDate(new Date(starts + hours * 3600000).toISOString()) }));
        setError(''); onDraft();
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        if (draft.salePercent || draft.saleStarts || draft.saleEnds || saleEnabled) {
            if (!validPercent) { setError('Enter a sale discount greater than 0 and less than 100, or remove the sale.'); return; }
            if (!Number.isFinite(Date.parse(draft.saleStarts)) || !Number.isFinite(Date.parse(draft.saleEnds)) || duration <= 0) { setError('Enter a sale end date and time after its start, or remove the sale.'); return; }
        }
        if (batchChanged && batchDraft.coaAvailable && !exactReport) { setError('Choose an eligible original report with the same lot before marking its COA available.'); return; }
        if (held && selected === 'available') {
            if (!canRelease) { setError('An owner must review and release this product before it can accept orders.'); return; }
            if (!batchDraft.lot.trim()) { setError('Enter the current product lot before releasing this product.'); return; }
            if (failedLot) { setError('Lot 702-20-0001 cannot be released. Enter the reviewed replacement lot.'); return; }
            if (!releaseReviewed || releaseReason.trim().length < 10) { setError('Confirm the owner review and enter a reason of at least 10 characters.'); return; }
        }
        setError(''); void onSave(event);
    }
    return <section className={`${styles.products} ${styles.editor} ${styles[group.color]}`} aria-labelledby="product-editor-title">
        <header className={styles.editorHeading}><div><p className={styles.formatLabel}>{group.label}</p><h2 id="product-editor-title">{p.name}</h2><p>{p.sizes.join(' · ')}{p.sku ? ` · SKU ${p.sku}` : ''}</p></div><a href={`/product/${p.slug}?measurement=off`} target="_blank" rel="noopener noreferrer">View product page</a></header>
        <form onSubmit={submit} className={styles.editorForm}>
            <input name="packPricingMode" type="hidden" value={packPricingMode}/>
            <input name="batchChanged" type="hidden" value={batchChanged ? 'true' : 'false'}/>
            <fieldset disabled={busy} className={styles.formContents}>
                <div className={styles.editorGrid}>
                    <div className={styles.mainColumn}>
                        <section className={styles.panel} aria-labelledby="product-price-title"><h3 id="product-price-title">Price & packs</h3><p>Set the base price before offers. Fixed-pack amounts are totals for the whole pack.</p>
                            <label className={styles.field}><span>Single product price ($)</span><input name="price" type="number" min="0.01" max="99999.99" step="0.01" required value={draft.price} onChange={e => field('price', e.target.value)}/></label>
                            {supportsPacks(p) && <><div className={styles.threeColumns}>{([3, 5, 10] as const).map(n => <label className={styles.field} key={n}><span>{n}-pack total ($)</span><input name={`fixed${n}`} type="number" min="0.01" max="999999.99" step="0.01" value={draft[`fixed${n}`]} onChange={e => field(`fixed${n}`, e.target.value)} placeholder="Standard discount"/></label>)}</div><p className={styles.help}>Changing the single price recalculates 3-, 5- and 10-pack totals at 10%, 15% and 20% off. You can edit these totals afterward for custom pricing, or leave one blank to use its standard discount. Mixed-pack settings stay unchanged.</p></>}
                        </section>
                        <section className={`${styles.panel} ${styles.salePanel}`} aria-labelledby="product-sale-title"><div className={styles.sectionHeading}><h3 id="product-sale-title">Sale</h3><label className={styles.toggle}><input type="checkbox" checked={saleEnabled} onChange={e => { if (!busy) onEdit({ ...p, sale: { enabled: e.target.checked, percentOff: p.sale?.percentOff || 0, starts: p.sale?.starts || '', ends: p.sale?.ends || '' } }); }}/><span>Enable scheduled sale</span></label></div>
                            <p>Choose the percentage, start and end. The website shows the sale timer while this offer is active.</p>
                            {preorderEnabled && <p className={styles.explanation}>Preorder pricing takes priority. This sale will not apply while the preorder offer is enabled.</p>}
                            <div className={styles.salePreview}><label className={styles.field}><span>Sale discount (%)</span><input name="salePercent" type="number" min="0.01" max="99" step="0.01" required={saleEnabled} value={draft.salePercent} onChange={e => field('salePercent', e.target.value)}/></label>
                                <output aria-live="polite" className={styles.preview}>{discounted == null ? <span>Enter a price and discount to preview.</span> : <><span>Sale price per item</span><strong>{money(discounted)}</strong><span>Save {money(baseCents - discounted)} ({percent}%)</span></>}</output></div>
                            <div className={styles.twoColumns}><label className={styles.field}><span>Sale starts</span><input name="saleStarts" type="datetime-local" required={saleEnabled} value={draft.saleStarts} onChange={e => field('saleStarts', e.target.value)}/></label><label className={styles.field}><span>Sale ends</span><input name="saleEnds" type="datetime-local" required={saleEnabled} value={draft.saleEnds} onChange={e => field('saleEnds', e.target.value)}/></label></div>
                            <div className={styles.duration}><span>Duration from start</span>{[[24, '24 hours'], [72, '3 days'], [168, '7 days']].map(([hours, label]) => <button key={hours} type="button" onClick={() => saleDuration(Number(hours))}>{label}</button>)}</div>
                            <p className={styles.help}>Times use {zone}. {Number.isFinite(duration) && duration > 0 ? `Duration: ${durationDays} ${durationDays === 1 ? 'day' : 'days'} (${durationHours} ${durationHours === 1 ? 'hour' : 'hours'}). ` : ''}The offer starts and ends automatically after saving.</p>
                            <p className={styles.help}>Discounts apply to single products and fixed-pack totals. Mixed-pack and promo savings still apply.</p>
                            {(draft.salePercent || draft.saleStarts || draft.saleEnds || saleEnabled) && <button type="button" className={styles.textButton} onClick={() => { if (busy) return; setDraft(previous => ({ ...previous, salePercent: '', saleStarts: '', saleEnds: '' })); setError(''); onEdit({ ...p, sale: null }); }}>Remove sale from this draft</button>}
                        </section>
                    </div>
                    <div className={styles.sideColumn}>
                        <section className={styles.panel}><fieldset className={styles.statusChoices}><legend>Availability</legend>{states.map(state => <label key={state.value} className={`${styles.statusChoice} ${styles[state.value]}`} data-selected={selected === state.value}>
                            <input type="radio" name="availability" value={state.value} checked={selected === state.value} disabled={busy} onChange={() => status(state.value)}/><span><strong>{state.label}</strong><small>{state.description}</small></span>
                        </label>)}</fieldset>{held && <><p className={styles.explanation}>Publication hold: {productAvailabilityLabel(batchProduct)}. Selecting Available requires a separate owner review of the current lot; it does not release the product until saved successfully.</p>{selected === 'available' && (canRelease ? <div className={styles.releaseReview}><h4>Owner release review</h4><p>Verify the replacement lot, inventory and supporting records. The earlier held lot remains blocked.</p><label className={styles.toggle}><input name="releaseReviewed" type="checkbox" required checked={releaseReviewed} onChange={e => { if (busy) return; setReleaseReviewed(e.target.checked); setError(''); onDraft(); }}/><span>I reviewed this lot and approve opening orders.</span></label><label className={styles.field}><span>Review reason</span><textarea name="releaseReason" minLength={10} maxLength={500} rows={3} required value={releaseReason} onChange={e => { if (busy) return; setReleaseReason(e.target.value); setError(''); onDraft(); }}/></label></div> : <p className={styles.explanation}>Only an owner can release a held product. Ask an owner to review the current lot.</p>)}</>}
                            {selected === 'available' && draft.stockQuantity !== '' && Number(draft.stockQuantity) <= 0 && <p className={styles.explanation}>Verified stock is zero. Customers will see Sold out until a positive quantity is saved.</p>}
                            {selected !== 'available' && <p className={styles.help}>Changing availability does not change your inventory count. Customers cannot order this product.</p>}
                        </section>
                        {p.preorder && <section className={styles.panel} aria-labelledby="product-preorder-title"><h3 id="product-preorder-title">Initial-run preorder</h3><label className={styles.toggle}><input type="checkbox" checked={preorderEnabled} onChange={e => { if (!busy && p.preorder) onEdit({ ...p, preorder: { ...p.preorder, enabled: e.target.checked } }); }}/><span>Offer as preorder</span></label>
                            <p>Available preorders accept payment now for later dispatch. Coming soon does not accept orders.</p><div className={styles.twoColumns}><label className={styles.field}><span>Preorder discount (%)</span><input name="preorderPercent" type="number" min="0.01" max="99" step="0.01" required value={draft.preorderPercent} onChange={e => field('preorderPercent', e.target.value)}/></label><label className={styles.field}><span>Estimated dispatch</span><input name="preorderShips" maxLength={120} required value={draft.preorderShips} onChange={e => field('preorderShips', e.target.value)}/></label></div><p className={styles.help}>Disable when ready to ship. Existing orders retain their saved dispatch estimate.</p>
                        </section>}
                        <section className={styles.panel} aria-labelledby="product-batch-title"><h3 id="product-batch-title">Lot & original COA</h3>
                            <label className={styles.field}><span>Current product lot</span><input name="batchLot" maxLength={100} value={batchDraft.lot} required={held && selected === 'available'} onChange={e => changeLot(e.target.value)} placeholder="Enter the lot printed on this stock"/></label>
                            <p className={styles.help}>Changing the lot clears the old report association. Existing orders keep their original lot and report records.</p>
                            <label className={styles.field}><span>Original laboratory report</span><select name="batchReportRef" value={batchDraft.reportRef} onChange={e => changeReport(e.target.value)}><option value="">No report attached</option>{batchDraft.reportRef && !reportChoices.some(choice => choice.ref === batchDraft.reportRef) && <option value={batchDraft.reportRef}>Saved report unavailable for selection</option>}{reportChoices.map(choice => <option key={choice.ref} value={choice.ref} disabled={!(choice.identityEligible ?? choice.eligible) || !choice.lot || choice.lot.trim() !== batchDraft.lot.trim()}>{choice.reportId || choice.filename} · {choice.strength} · Lot {choice.lot || 'not listed'}{!(choice.identityEligible ?? choice.eligible) ? ' · Requires review' : choice.lot?.trim() !== batchDraft.lot.trim() ? ' · Different lot' : ''}</option>)}</select></label>
                            <p className={styles.help}>{reportChoices.length ? 'Only originals that match this product, strength and lot can be marked available.' : 'No original report is registered for this product yet. Entering a lot does not create or verify a certificate.'}</p>
                            {attached ? <div className={styles.batchSummary}><strong>{exactReport ? 'Exact product and lot match' : 'Report needs review'}</strong><dl><div><dt>Report</dt><dd>{attached.reportId || attached.filename}</dd></div><div><dt>Product / contents</dt><dd>{attached.productName} · {attached.strength}</dd></div><div><dt>Certificate lot</dt><dd>{attached.lot || 'Not listed'}</dd></div></dl>{!exactReport && <p>{attached.reason || 'This report does not verify the current product lot.'}</p>}{attached.url ? <a href={attached.url} target="_blank" rel="noopener noreferrer">Read original report</a> : <p>The original has no public download link.</p>}</div> : <p className={styles.help}>No original COA is attached to this lot.</p>}
                            <label className={styles.toggle}><input name="batchCoaAvailable" type="checkbox" checked={batchDraft.coaAvailable} disabled={busy || !exactReport} onChange={e => { if (busy || !exactReport) return; setBatchDraft(previous => ({ ...previous, coaAvailable: e.target.checked })); setError(''); onDraft(); }}/><span>COA available for the current lot</span></label>
                            <p className={styles.help}>This controls availability of the attached original under its existing sharing policy. It does not certify purity or change the laboratory report.</p>
                            {failedLot && <p className={styles.explanation}>Lot 702-20-0001 is held and cannot be released. A reviewed replacement lot is required.</p>}
                        </section>
                        <section className={styles.panel} aria-labelledby="product-inventory-title"><h3 id="product-inventory-title">Inventory</h3><div className={styles.twoColumns}><label className={styles.field}><span>Verified inventory quantity</span><input name="stockQuantity" type="number" min="0" max="100000" step="1" value={draft.stockQuantity} onChange={e => field('stockQuantity', e.target.value)}/></label><label className={styles.field}><span>Maximum per order</span><input name="maxQuantity" type="number" min="1" max="100000" step="1" required value={draft.maxQuantity} onChange={e => field('maxQuantity', e.target.value)}/></label></div><p className={styles.help}>Blank stock means not set. Saving checks for inventory changes and stock already reserved by orders.</p></section>
                    </div>
                </div>
            </fieldset>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.saveBar}><p>Changes apply after saving. Existing orders are preserved.</p><button type="button" className={styles.textButton} disabled={busy} onClick={onCancel}>Discard product draft</button><button type="submit" className="button button-dark" disabled={busy}>{busy ? 'Saving product…' : 'Save product'}</button></div>
        </form>
    </section>;
}
