'use client';
// Inviting a partner with their terms, on the owner's Affiliates page (owner, Nov 21 2026: "the
// terms, percentages and name they are agreeing to, like lupe10 or lupe15, and she gets 15% for
// everyone she refers. Or 10 and 10. Depends on the situation").
//
// One form: who, what their customers get, what they earn. The code writes itself from the name and
// the discount. Saving creates the code across the store and holds the terms for the partner, and
// the invitation email, with those terms in it, is sent from the same row.
import { useRef, useState, type FormEvent } from 'react';
import {
    partnerCode, commissionBps, percentText, termsSentence, channelsText, invitationMessage,
    DEFAULT_HOLD_DAYS, DEFAULT_PAYOUT_METHODS, DEFAULT_CHANNELS, MAX_DISCOUNT_PERCENT, MAX_NOTE_LENGTH,
    type InviteTerms, type ProgramTerms,
} from '@/lib/affiliate-invite-terms';
import styles from './affiliate-invitations.module.css';

export type Invitation = {
    email: string; active: number; created: number; updated: number; name: string | null; code: string | null;
    discount_percent: number | null; commission_bps: number | null; hold_days: number | null; payout_methods: string | null; channels: string | null;
    member: string | null; email_status: string | null; emailed: number | null;
};
type Draft = { email: string; name: string; discount: string; commission: string; code: string; hold: string; methods: string; online: boolean; inPerson: boolean };
const blank: Draft = { email: '', name: '', discount: '', commission: '', code: '', hold: String(DEFAULT_HOLD_DAYS), methods: DEFAULT_PAYOUT_METHODS, online: true, inPerson: true };

const termsOf = (row: Invitation): InviteTerms | null => !row.code || row.discount_percent == null || row.commission_bps == null ? null : {
    name: row.name || row.email, code: row.code, discountPercent: row.discount_percent, commissionBps: row.commission_bps,
    holdDays: row.hold_days ?? DEFAULT_HOLD_DAYS, payoutMethods: row.payout_methods || DEFAULT_PAYOUT_METHODS,
    channels: (row.channels || DEFAULT_CHANNELS.join(',')).split(',').filter(Boolean),
};
const when = (value: number) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/affiliates?admin=1', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({ error: 'The server did not respond. Try again.' })) as { message?: string; error?: string };
    if (!response.ok) throw Error(data.error || 'Could not save. Try again.');
    return data;
}

export function AffiliateInvitations({ invitations, program, open, talkingPointsReady, mailReady, reload }: {
    invitations: Invitation[];
    /** The two figures every partner shares, from the published agreement. Null until one is published. */
    program: ProgramTerms | null;
    open: boolean;
    talkingPointsReady: boolean;
    mailReady: boolean;
    reload: () => void | Promise<void>;
}) {
    const [draft, setDraft] = useState<Draft>(blank);
    // The address being changed, or null while inviting someone new. An address is the invitation's
    // identity, so it cannot be edited in place: a wrong one is revoked and the right one invited.
    const [editing, setEditing] = useState<string | null>(null);
    // Until the owner types a code of their own, it follows the name and the discount.
    const [ownCode, setOwnCode] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    // Where the last confirmation or error belongs: '' is the form, otherwise that invitation's row,
    // so it is read beside the button that caused it rather than a screen away.
    const [where, setWhere] = useState('');
    const [emailing, setEmailing] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const formRef = useRef<HTMLFormElement>(null);

    const set = (patch: Partial<Draft>) => setDraft(current => {
        const next = { ...current, ...patch };
        if (!ownCode && patch.code === undefined) next.code = partnerCode(next.name, Number(next.discount));
        return next;
    });
    const discount = Number(draft.discount), commission = Number(draft.commission);
    const discountOk = draft.discount.trim() !== '' && Number.isInteger(discount) && discount >= 1 && discount <= MAX_DISCOUNT_PERCENT;
    const commissionOk = draft.commission.trim() !== '' && Number.isFinite(commission) && commission >= 0 && commission <= 100;
    const code = draft.code.trim().toUpperCase();
    const codeOk = /^[A-Z0-9]{3,40}$/.test(code);
    const ready = Boolean(draft.email.trim() && draft.name.trim() && discountOk && commissionOk && codeOk && (draft.online || draft.inPerson));
    const givenAway = discountOk && commissionOk ? discount + commission : 0;
    const editingRow = editing ? invitations.find(row => row.email === editing) : undefined;
    const editingHasTerms = Boolean(editingRow && termsOf(editingRow));
    const notice = (at: string) => where !== at ? null : error ? <p role="alert" className="notice error">{error}</p> : message ? <p role="status" className={styles.saved}>{message}</p> : null;

    function begin(row: Invitation | null) {
        setError(''); setMessage(''); setWhere(''); setEmailing(null);
        if (!row) { setEditing(null); setOwnCode(false); setDraft(blank); return; }
        const channels = (row.channels || DEFAULT_CHANNELS.join(',')).split(',');
        const next: Draft = {
            email: row.email, name: row.name || '', discount: row.discount_percent == null ? '' : String(row.discount_percent),
            commission: row.commission_bps == null ? '' : percentText(row.commission_bps), code: row.code || '',
            hold: String(row.hold_days ?? DEFAULT_HOLD_DAYS), methods: row.payout_methods || DEFAULT_PAYOUT_METHODS,
            online: channels.includes('online'), inPerson: channels.includes('in_person'),
        };
        setEditing(row.email);
        setOwnCode(Boolean(row.code) && row.code !== partnerCode(next.name, Number(next.discount)));
        setDraft(next);
        formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        formRef.current?.querySelector<HTMLInputElement>('input[name=name]')?.focus({ preventScroll: true });
    }
    async function run(body: Record<string, unknown>, after?: () => void, row = '') {
        setBusy(true); setError(''); setMessage(''); setWhere(row);
        try { const result = await post(body); setMessage(result.message || 'Saved.'); after?.(); await reload(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
        finally { setBusy(false); }
    }
    function save(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!ready || busy) return;
        void run({
            action: 'inviteTerms', email: draft.email.trim(), name: draft.name, code, discountPercent: discount, commissionBps: commissionBps(commission),
            holdDays: Number(draft.hold), payoutMethods: draft.methods, channels: [draft.online && 'online', draft.inPerson && 'in_person'].filter(Boolean),
        }, () => { setEditing(null); setOwnCode(false); setDraft(blank); });
    }
    function revoke(row: Invitation) {
        const terms = termsOf(row);
        if (!window.confirm('Revoke the invitation for ' + (row.name || row.email) + '?\n\n' + (terms ? 'Their code ' + terms.code + ' is switched off. It stays in the Promo codes list.' : 'They will no longer be able to apply.'))) return;
        void run({ action: 'invite', email: row.email, active: false }, () => { if (editing === row.email) { setEditing(null); setOwnCode(false); setDraft(blank); } }, row.email);
    }
    async function copy(text: string, row: string) {
        setError(''); setMessage(''); setWhere(row);
        try { await navigator.clipboard.writeText(text); setMessage('Invitation copied. Paste it into an email or a text.'); }
        catch { setError('This browser would not copy it. Select the invitation text and copy it yourself.'); }
    }

    return <section className={styles.invitations} aria-labelledby="affiliate-invite-title">
        <h3 id="affiliate-invite-title">{editing ? (editingHasTerms ? 'Change terms for ' : 'Set terms for ') + (draft.name.trim() || editing) : 'Invite a partner'}</h3>
        <p>Set the name they are agreeing to, what their customers get and what they earn. Saving creates the code across the store, and the terms are waiting for them when they sign in. Then email the invitation from the list below.</p>
        {!program && <p className="notice">Publish the program agreement first. Invitations are saved against it.</p>}
        {program && !open && <p className="notice">Invited applications are paused, so an invited person cannot apply yet. Open them with the button above before you email anyone.</p>}
        {program && !talkingPointsReady && <p className="notice">One approval is still open: the one-page talking points partners sign with their terms. You can invite people now. They can sign once you approve it under “Partner offers, W-9s and payments” further down this page.</p>}
        <form ref={formRef} className="store-form" onSubmit={save} noValidate={false}>
            <div className="form-row">
                <label className="field">Partner’s email
                    <input name="email" type="email" required maxLength={254} autoComplete="off" value={draft.email} readOnly={Boolean(editing)} aria-readonly={Boolean(editing)}
                        placeholder="lupe@example.com" onChange={e => set({ email: e.target.value })}/>
                </label>
                <label className="field">Partner’s name
                    <input name="name" required maxLength={80} autoComplete="off" value={draft.name} placeholder="Lupe" onChange={e => set({ name: e.target.value })}/>
                </label>
            </div>
            <div className="form-row">
                <label className="field">Customers get (% off)
                    <input name="discount" type="number" inputMode="numeric" required min={1} max={MAX_DISCOUNT_PERCENT} step={1} value={draft.discount} placeholder="10" onChange={e => set({ discount: e.target.value })}/>
                </label>
                <label className="field">Partner earns (% of each sale)
                    <input name="commission" type="number" inputMode="decimal" required min={0} max={100} step={0.01} value={draft.commission} placeholder="15" onChange={e => set({ commission: e.target.value })}/>
                </label>
                <label className="field">Their code
                    <input name="code" required maxLength={40} spellCheck={false} autoComplete="off" autoCapitalize="characters" className={styles.code} value={draft.code} placeholder="LUPE10"
                        onChange={e => { setOwnCode(true); set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }); }}
                        // Emptied and left: go back to the name and the discount rather than leave no code.
                        onBlur={e => { if (!e.target.value.trim()) { setOwnCode(false); set({ code: partnerCode(draft.name, Number(draft.discount)) }); } }}/>
                </label>
            </div>
            <p className={styles.summary} aria-live="polite">{ready
                ? <><strong className={styles.code}>{code}</strong> gives {draft.name.trim()}’s customers {discount}% off. {draft.name.trim()} earns {percentText(commissionBps(commission))}% of each sale, figured after the discount.</>
                : draft.code && !codeOk ? 'A code is 3 to 40 letters and digits, such as LUPE10.'
                : 'The code is the name and the discount together: Lupe at 10% off is LUPE10. You can type a different one.'}</p>
            {givenAway >= 50 && <p className="notice">Together the discount and the commission come to {givenAway}% of each sale. Check both numbers before saving.</p>}
            <details className={styles.terms}>
                <summary>Payment terms: {draft.hold || '0'}-day hold, paid by {draft.methods || 'check or ACH'}, code works {channelsText([draft.online ? 'online' : '', draft.inPerson ? 'in_person' : ''])}</summary>
                <div className="form-row">
                    <label className="field">Hold after payment (days)
                        <input name="hold" type="number" inputMode="numeric" required min={0} max={365} step={1} value={draft.hold} onChange={e => set({ hold: e.target.value })}/>
                    </label>
                    <label className="field">Paid by (no bank details here)
                        <input name="methods" required minLength={2} maxLength={300} value={draft.methods} onChange={e => set({ methods: e.target.value })}/>
                    </label>
                </div>
                <fieldset className={'field ' + styles.channels}><legend>Code works</legend>
                    <label><input type="checkbox" checked={draft.online} onChange={e => set({ online: e.target.checked })}/> Online</label>
                    <label><input type="checkbox" checked={draft.inPerson} onChange={e => set({ inPerson: e.target.checked })}/> In person</label>
                </fieldset>
            </details>
            <div className={styles.actions}>
                <button className="button button-dark" disabled={busy || !ready || !program}>{busy ? 'Saving…' : editing ? 'Save terms' : 'Save invitation'}</button>
                {editing && <button type="button" className="text-button" disabled={busy} onClick={() => begin(null)}>Cancel</button>}
            </div>
        </form>
        {notice('')}

        <h3 className={styles.listTitle}>Invitations</h3>
        {!invitations.length && <p>Nobody has been invited yet.</p>}
        {invitations.map(row => {
            const terms = termsOf(row);
            const invite = terms && program && row.active && !row.member ? invitationMessage({ terms, program, email: row.email, note: emailing === row.email ? note : '' }) : null;
            const changedSinceEmail = Boolean(row.emailed && row.email_status === 'accepted' && row.updated > row.emailed);
            return <article className="account-record" key={row.email}>
                <h4>{row.name ? <>{row.name} <span className={styles.address}>{row.email}</span></> : row.email}</h4>
                {!row.active ? <p>Revoked. {terms ? 'Code ' + terms.code + ' is switched off.' : ''}</p>
                    : row.member ? <p>Applied. {terms ? termsSentence(terms) + '. ' : ''}Their record is under Applications and partners below.</p>
                    : terms ? <>
                        <p><strong className={styles.code}>{terms.code}</strong> · customers get {terms.discountPercent}% off · {row.name || 'partner'} earns {percentText(terms.commissionBps)}% of each sale</p>
                        <p className={styles.meta}>{terms.holdDays}-day hold · paid by {terms.payoutMethods} · code works {channelsText(terms.channels)}</p>
                        <p className={styles.meta}>{row.email_status === 'accepted' && row.emailed ? 'Invitation emailed ' + when(row.emailed) + '.' + (changedSinceEmail ? ' The terms changed after that. Send it again so they have the current ones.' : '')
                            : row.email_status === 'failed' ? 'The last invitation email was rejected by the mail provider. Check the address.'
                            : row.email_status === 'unknown' || row.email_status === 'sending' ? 'The last invitation email was not confirmed by the mail provider. Check before sending again.'
                            : 'Not emailed yet.'}</p>
                    </>
                    : <p>No terms yet. This person can apply, and then waits for an offer. Set their terms so the offer is ready when they sign in.</p>}
                <div className={styles.actions}>
                    {invite && mailReady && open && <button type="button" className="text-button" disabled={busy} aria-expanded={emailing === row.email}
                        onClick={() => { setError(''); setMessage(''); setWhere(row.email); setNote(''); setEmailing(emailing === row.email ? null : row.email); }}>{row.email_status === 'accepted' ? 'Email it again' : 'Email the invitation'}</button>}
                    {invite && <button type="button" className="text-button" disabled={busy} onClick={() => void copy(invite.text, row.email)}>Copy invitation</button>}
                    {!row.member && <button type="button" className="text-button" disabled={busy} onClick={() => begin(row)}>{!row.active ? 'Invite again' : terms ? 'Change terms' : 'Set terms'}</button>}
                    {Boolean(row.active) && <button type="button" className="text-button" disabled={busy} onClick={() => revoke(row)}>Revoke</button>}
                </div>
                {invite && emailing === row.email && <div className={styles.preview}>
                    <p><strong>To:</strong> {row.email}<br/><strong>Subject:</strong> {invite.subject}</p>
                    <label className="field">Add a line of your own (optional)
                        <textarea rows={2} maxLength={MAX_NOTE_LENGTH} value={note} placeholder="Great meeting you last week." onChange={e => setNote(e.target.value)}/>
                    </label>
                    <pre className={styles.message}>{invite.text}</pre>
                    <div className={styles.actions}>
                        <button type="button" className="button button-dark" disabled={busy} onClick={() => void run({ action: 'inviteEmail', email: row.email, note }, () => { setEmailing(null); setNote(''); }, row.email)}>{busy ? 'Sending…' : 'Send this email'}</button>
                        <button type="button" className="text-button" disabled={busy} onClick={() => setEmailing(null)}>Cancel</button>
                    </div>
                </div>}
                {notice(row.email)}
            </article>;
        })}
    </section>;
}
