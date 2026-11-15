'use client';

import { FormEvent, useId, useState } from 'react';
import { TEXT_CONSENT_TEXT, TEXT_OFFER_PERCENT } from '@/lib/text-offer-wording';
import { api, useStore } from './provider';
import styles from './promo-code.module.css';

/** Text sign-up offer on the cart page: a mobile number and one button for a 10% code. */
export function TextOffer({ disabled = false }: { disabled?: boolean }) {
  const { refresh } = useStore();
  const id = useId();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    if (phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) { setError('Enter a 10-digit U.S. mobile number.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api('text-offer', { phone, consent: true });
      setDone(result.message || 'Your code is on its way.');
      if (result.applied) await refresh().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  if (done) return <div className={styles.promo}><p className={styles.message} role="status"><strong>{done}</strong></p></div>;
  return <div className={styles.promo} aria-busy={busy}>
    <form onSubmit={submit} className={styles.form}>
      <label htmlFor={id}>Get {TEXT_OFFER_PERCENT}% off by text</label>
      <div className={styles.entry}>
        <input id={id} name="textOfferPhone" type="tel" inputMode="tel" autoComplete="tel" placeholder="Mobile number" value={phone} onChange={event => { setPhone(event.target.value); setError(''); }} disabled={busy} maxLength={20} aria-invalid={Boolean(error)} aria-describedby={id + '-terms' + (error ? ' ' + id + '-error' : '')}/>
        <button type="submit" className={styles.apply} disabled={busy || disabled}>{busy ? 'Sending…' : 'Get my code'}</button>
      </div>
      <p id={id + '-terms'} className={styles.message} style={{ fontSize: 12 }}>{TEXT_CONSENT_TEXT}</p>
    </form>
    {error && <p id={id + '-error'} className={styles.error} role="alert">{error}</p>}
  </div>;
}
