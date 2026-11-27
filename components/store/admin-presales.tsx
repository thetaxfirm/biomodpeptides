'use client';
import { useRef, useState, type FormEvent } from 'react';
import type { Product } from '@/lib/catalog';
import { presaleStatus, type PresaleCampaign } from '@/lib/presale-campaigns';
import { PresaleProductPicker } from './presale-product-picker';
const localDate = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
type Props = { campaigns: PresaleCampaign[]; products: Product[]; enabled: boolean; busy: boolean; onDraft: () => number; onDiscard: (revision: number) => void; onSave: (event: FormEvent<HTMLFormElement>, campaign: PresaleCampaign | null) => void; onChange: (campaign: PresaleCampaign, patch: Partial<PresaleCampaign>) => void };
export function AdminPresales({ campaigns, products, enabled, busy, onDraft, onDiscard, onSave, onChange }: Props) {
    const [editing, setEditing] = useState<PresaleCampaign | null>(null), [filter, setFilter] = useState('All'), [dirty, setDirty] = useState(false);
    const revision = useRef(0);
    const [generation, setGeneration] = useState(0);
    const visible = campaigns.filter(c => filter === 'All' ? !c.archived : presaleStatus(c) === filter);
    function discard() { onDiscard(revision.current); setDirty(false); setEditing(null); setGeneration(value => value + 1); }
    return <section><h2>Presale campaigns</h2><p>Scheduled campaigns are {enabled ? 'enabled' : 'disabled'} in Settings. Product-level preorder offers are managed separately under Products and continue to follow their own switches.</p>
        <label className="field">Show campaigns<select value={filter} onChange={e => setFilter(e.target.value)}>{['All','Upcoming','Open','Ended','Disabled','Archived'].map(v => <option key={v}>{v}</option>)}</select></label>
        {visible.map(c => <article className="account-record" key={c.id}><h3>{c.title}</h3><p>{presaleStatus(c)}{presaleStatus(c) === 'Open' && !enabled ? ' · Ordering paused in Settings' : ''} · {new Date(c.starts).toLocaleString()} to {new Date(c.ends).toLocaleString()}</p><p>Expected shipping: {c.ships} · Limit {c.maxPerCustomer} units per customer</p><div className="form-row">
            <button className="text-button" disabled={busy || dirty} onClick={() => setEditing(c)}>Edit campaign</button>
            {!c.archived && <button className="text-button" disabled={busy || dirty} onClick={() => onChange(c, { active: !c.active })}>{c.active ? 'Disable' : 'Enable'}</button>}
            <button className="text-button" disabled={busy || dirty} onClick={() => onChange(c, { archived: !c.archived, active: false })}>{c.archived ? 'Restore as disabled' : 'Archive'}</button>
        </div></article>)}
        {!visible.length && <p>No campaigns in this view.</p>}
        <form key={(editing?.id || 'new') + ':' + generation} className="store-form" onChangeCapture={() => { revision.current = onDraft(); setDirty(true); }} onSubmit={e => onSave(e, editing)}><fieldset disabled={busy}><legend>{editing ? 'Edit campaign' : 'Create a presale'}</legend>
            <label className="field">Campaign title<input required name="title" defaultValue={editing?.title || ''} maxLength={100}/></label>
            <div className="form-row"><label className="field">Opens<input required name="starts" type="datetime-local" defaultValue={localDate(editing?.starts || '')}/></label><label className="field">Closes<input required name="ends" type="datetime-local" defaultValue={localDate(editing?.ends || '')}/></label></div>
            <p>Times use your device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
            <label className="field">Expected shipping<input required name="ships" defaultValue={editing?.ships || ''} maxLength={100}/></label>
            <PresaleProductPicker products={products} initialSelected={editing?.productIds || []}/>
            <label className="field">Maximum units per customer<input required name="maxPerCustomer" type="number" min="1" max="100" defaultValue={editing?.maxPerCustomer || 1}/></label>
            <button className="button button-dark">{editing ? 'Save campaign changes' : 'Save disabled campaign'}</button>
            {(editing || dirty) && <button type="button" className="text-button" onClick={discard}>Discard edits</button>}
        </fieldset></form>
    </section>;
}
