'use client';
// The tracking number an order is being followed on, and the one it carried before (owner, Nov 20
// 2026: "in the off chance the customer dosnt recive it and it comes back to us or there is a
// double order ... id like a slot on each order to insert a new tracking info into if i have to
// manually make a label ... i want the system to read it and check on the newly updated one for
// status updates ... just do a red dot and a green one").
//
// Two parts, and the order matters: the history first, so whoever is about to type a number can
// see what is already there, then the slot.
//
// The history names every number this order has carried. The superseded one gets a red dot and is
// said in words to be out of use; the live one gets a green dot and is said to be the one being
// followed. The words carry the meaning on their own -- the dots repeat it, rather than being the
// only way to tell, so this still reads correctly to anyone who cannot separate the two colours.
//
// The slot records a replacement parcel. It asks EasyPost about the number before saving anything
// and then takes whatever the carrier says, so it can record that a parcel arrived but can never
// claim one did. That is why it is a separate control from the manual confirmation form below it,
// which is a person's own statement and is kept only for numbers EasyPost cannot read at all.
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { carrierWords } from '@/lib/fulfillment';
import styles from './order-tracking.module.css';

async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/admin/order-reship', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

type Parcel = { tracking?: string; status?: string; service?: string; trackingUrl?: string; shipmentId?: string; reshipAt?: number; reshipBy?: string; reshipNote?: string };
const parcelOf = (value: unknown): Parcel | null => value && typeof value === 'object' ? value as Parcel : null;
const day = (at: unknown) => typeof at === 'number' && Number.isFinite(at) ? new Date(at).toLocaleDateString([], { dateStyle: 'medium' }) : '';
const words = (status: unknown) => {
    const key = String(status || '');
    return key ? carrierWords[key] || key.replaceAll('_', ' ') : 'No carrier update recorded';
};

/** One number, said plainly: what it is, what the carrier last said, and whether it is still followed. */
function Line({ parcel, live }: { parcel: Parcel; live: boolean }) {
    return <li className={styles.parcel} data-live={live}>
        <span className={styles.dot} aria-hidden="true"/>
        <span className={styles.body}>
            <span className={styles.number}>
                {parcel.trackingUrl
                    ? <a href={parcel.trackingUrl} target="_blank" rel="noopener noreferrer">{parcel.tracking}</a>
                    : <strong>{parcel.tracking || 'No tracking number recorded'}</strong>}
                {parcel.service ? <span className={styles.quiet}>{parcel.service}</span> : null}
            </span>
            <span className={styles.state}>{words(parcel.status)}</span>
            <span className={styles.verdict}>
                {live ? 'Tracked: the carrier is checked on this number' : 'No longer tracked'}
                {!live && parcel.reshipAt ? ' · replaced ' + day(parcel.reshipAt) : ''}
            </span>
            {live && parcel.reshipAt ? <span className={styles.quiet}>Recorded by hand {day(parcel.reshipAt)}{parcel.reshipBy ? ' by ' + parcel.reshipBy : ''}{parcel.reshipNote ? ' · ' + parcel.reshipNote : ''}</span> : null}
        </span>
    </li>;
}

export function OrderTracking({ order, allowed, busy, onDone }: { order: any; allowed: (permission: string) => boolean; busy: boolean; onDone: () => void }) {
    const [tracking, setTracking] = useState('');
    const [carrier, setCarrier] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    const live = parcelOf(order?.data?.shipment);
    const previous = parcelOf(order?.data?.previousShipment);
    const number = '#' + String(order?.id || '').slice(0, 8).toUpperCase();
    const canRecord = allowed('orders:fulfill') && ['paid', 'shipped', 'delivered'].includes(String(order?.status || ''));

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const code = tracking.trim().toUpperCase();
        if (!code) return;
        const ask = typeof window === 'undefined' ? undefined : window.confirm;
        if (ask && !ask('Record ' + code + ' as the tracking number for ' + number + '?\n\nThe carrier is asked about it first and decides the status. The number currently on the order is kept in the record. Nothing is bought and the customer is not emailed.')) return;
        setSaving(true);
        try {
            const result = await post({ orderId: order.id, tracking: code, carrier: carrier.trim(), note: note.trim() });
            toast.success(result.message || 'Tracking recorded.');
            setTracking(''); setCarrier(''); setNote('');
            onDone();
        }
        catch (error) { toast.error(error instanceof Error ? error.message : 'That could not be saved.'); }
        finally { setSaving(false); }
    }

    return <section className={styles.tracking} aria-label={'Tracking numbers on ' + number}>
        <h3>Tracking on this order</h3>
        {!live && !previous
            ? <p className={styles.quiet}>No tracking number is recorded on this order yet.</p>
            : <ul className={styles.list}>
                {previous && previous.tracking ? <Line parcel={previous} live={false}/> : null}
                {live ? <Line parcel={live} live={true}/> : null}
            </ul>}
        {previous && previous.tracking && live ? <p className={styles.quiet}>Only the number replaced most recently is kept here.</p> : null}

        {canRecord && <form className={styles.form} onSubmit={submit}>
            <p className={styles.lead}><strong>Record a different tracking number</strong> <span className={styles.quiet}>For a parcel sent again, a replacement, or a label made by hand outside the store. The carrier is asked about the number before anything is saved and sets the status, so this cannot mark a parcel delivered that the carrier has not seen. Nothing is bought and no email is sent.</span></p>
            <label>Tracking number
                <input value={tracking} onChange={e => setTracking(e.target.value)} maxLength={40} placeholder="9405500000000000000000" autoComplete="off" spellCheck={false} required/>
            </label>
            <label>Carrier (optional)
                <input value={carrier} onChange={e => setCarrier(e.target.value)} maxLength={30} placeholder="USPS" autoComplete="off" spellCheck={false}/>
            </label>
            <label>Note (optional)
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Returned vacant; reposted to the address he confirmed"/>
            </label>
            <button type="submit" className="button button-dark" disabled={busy || saving || !tracking.trim()}>{saving ? 'Checking with the carrier…' : 'Check and record this number'}</button>
        </form>}
        {!canRecord && allowed('orders:fulfill') ? <p className={styles.quiet}>{number} is not a paid order, so it has no parcel to record a replacement for.</p> : null}
    </section>;
}
