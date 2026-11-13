'use client';
// Twenty restaurant slots inside the Affiliates tab (owner, Nov 13 2026). Type a restaurant's name
// and the slot names its own link and discount code; the switch decides whether it prices anything.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PARTNER_SLOTS, MAX_PERCENT_OFF, slugFromName, codeFromName, type PartnerSlot } from '@/lib/restaurant-partners';

const ENDPOINT = '/api/admin/restaurant-partners';
const linkFor = (slug: string) => 'https://trybiomod.com/r/' + slug;

async function call(body?: unknown) {
    const response = await fetch(ENDPOINT, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({})) as { slots?: PartnerSlot[]; message?: string; error?: string };
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

export function RestaurantPartners() {
    const [slots, setSlots] = useState<PartnerSlot[] | null>(null);
    const [draft, setDraft] = useState<Record<number, { name: string; percentOff: string }>>({});
    const [busy, setBusy] = useState(0);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        call().then(d => { if (live) { setSlots(d.slots || []); setDraft({}); } }).catch(e => { if (live) setError(e.message); });
        return () => { live = false; };
    }, []);

    async function send(body: Record<string, unknown>, slot: number) {
        setBusy(slot); setError('');
        try {
            const d = await call(body);
            setSlots(d.slots || []);
            setDraft(current => { const next = { ...current }; delete next[slot]; return next; });
            toast.success(d.message || 'Saved.');
        }
        catch (e) { const message = e instanceof Error ? e.message : 'Request failed.'; setError(message); toast.error(message); }
        finally { setBusy(0); }
    }

    if (error && !slots) return <p className="notice">{error}</p>;
    if (!slots) return <p>Loading restaurant slots…</p>;

    const filled = slots.filter(s => s.name).length;
    const live = slots.filter(s => s.active).length;

    return <section aria-label="Restaurant partners">
        <p>{filled} of {PARTNER_SLOTS} slots filled · {live} live. Type a restaurant&apos;s name and the slot writes its own link and discount code. Nothing is discounted until you switch a slot on.</p>
        <p className="notice">A link only gives a restaurant credit once that restaurant is an approved affiliate with an accepted agreement and schedule. Until then the link still applies the discount, but the sale is credited to nobody.</p>
        {error && <p className="notice">{error}</p>}
        {slots.map(slot => {
            const edit = draft[slot.slot] ?? { name: slot.name, percentOff: slot.percentOff ? String(slot.percentOff) : '' };
            const changed = edit.name !== slot.name || edit.percentOff !== (slot.percentOff ? String(slot.percentOff) : '');
            // Shown before saving so the owner sees what the name will produce.
            const previewSlug = edit.name ? slugFromName(edit.name) : '';
            const previewCode = edit.name ? codeFromName(edit.name, slot.slot) : '';
            const working = busy === slot.slot;
            const set = (patch: Partial<typeof edit>) => setDraft(c => ({ ...c, [slot.slot]: { ...edit, ...patch } }));
            return <article className="account-record" key={slot.slot}>
                <h4>Slot {slot.slot}{slot.name ? ' · ' + slot.name : ' · empty'}{slot.active ? ' · LIVE' : ''}</h4>
                <div className="form-row">
                    <label className="field">Restaurant name
                        <input value={edit.name} maxLength={80} placeholder="Mario&apos;s Pizza" disabled={working}
                            onChange={e => set({ name: e.target.value })}/>
                    </label>
                    <label className="field">Discount (%)
                        <input type="number" min={1} max={MAX_PERCENT_OFF} step={1} value={edit.percentOff} disabled={working}
                            onChange={e => set({ percentOff: e.target.value })}/>
                    </label>
                </div>
                {slot.code
                    ? <p>Link <a href={'/r/' + slot.slug} target="_blank" rel="noopener">{linkFor(slot.slug)}</a> · code <strong>{slot.code}</strong>
                        {' '}<button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(linkFor(slot.slug)); toast.success('Link copied.'); }}>Copy link</button></p>
                    : previewSlug ? <p>Will become {linkFor(previewSlug)} · code <strong>{previewCode}</strong></p> : null}
                {slot.previous.length > 0 && <p className="notice">Retired codes, switched off but kept in case they are already printed: {slot.previous.join(', ')}</p>}
                <p>
                    <button type="button" className="button button-dark" disabled={working || !changed}
                        onClick={() => send({ slot: slot.slot, name: edit.name, slug: '', code: '', percentOff: edit.percentOff === '' ? 0 : Number(edit.percentOff) }, slot.slot)}>Save</button>
                    {' '}
                    <button type="button" className="text-button" disabled={working || changed || !slot.name || (!slot.active && !slot.percentOff)}
                        onClick={() => send({ slot: slot.slot, active: !slot.active }, slot.slot)}>{slot.active ? 'Switch off' : 'Switch on'}</button>
                    {' '}
                    {slot.name && <button type="button" className="text-button" disabled={working}
                        onClick={() => { if (window.confirm('Clear slot ' + slot.slot + '?\n\n' + slot.name + ' is removed and its code ' + slot.code + ' is switched off. The code is kept, not deleted, in case it is already printed somewhere.')) void send({ slot: slot.slot, clear: true }, slot.slot); }}>Clear</button>}
                </p>
            </article>;
        })}
    </section>;
}
