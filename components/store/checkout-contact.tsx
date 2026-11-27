'use client';

import { FormEvent, ReactNode, useId, useState } from 'react';
import { CHECKOUT_EMAIL_OPTIN_TEXT, CHECKOUT_PHONE_HELP, CHECKOUT_TEXT_CONSENT_LABEL, CHECKOUT_TEXT_CONSENT_NOTE, usPhoneDigits } from '@/lib/checkout-contact-wording';
import { Check } from './primitives';
import { api } from './provider';
import styles from './checkout-contact.module.css';

/** Left column of checkout: the contact step, then the delivery address. */
export function CheckoutColumn({ children }: { children: ReactNode }) { return <div className={styles.column}>{children}</div>; }

export type SavedContact = { email: string; phone: string; complete: boolean; emailOptIn: boolean; textConsent: boolean };

/**
 * First checkout screen for a guest (owner, Nov 27 2026): email and mobile number, saved the moment
 * they press Continue. Once saved it folds to one line with a Change link, and the delivery address
 * opens underneath with the number carried forward.
 */
export function CheckoutContact({ contact, prefill, editing, onSaved, onEdit }: {
  contact: SavedContact | null;
  prefill: { email: string; phone: string };
  editing: boolean;
  onSaved: (contact: SavedContact) => void;
  onEdit: () => void;
}) {
  const id = useId();
  const [emailOptIn, setEmailOptIn] = useState(contact ? contact.emailOptIn : true);
  const [textConsent, setTextConsent] = useState(contact ? contact.textConsent : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (contact?.complete && !editing) return <section className={styles.summary} aria-labelledby={id + '-title'}>
    <h2 id={id + '-title'}>Contact</h2>
    <p className={styles.line}><span>{contact.email} · {contact.phone}</span><button type="button" className={styles.change} onClick={onEdit}>Change</button></p>
  </section>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('guestEmail') || '').trim(), phone = String(fields.get('guestPhone') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setError('Enter a valid email address.'); event.currentTarget.querySelector<HTMLInputElement>('[name=guestEmail]')?.focus(); return; }
    if (!usPhoneDigits(phone)) { setError('Enter a 10-digit U.S. mobile number.'); event.currentTarget.querySelector<HTMLInputElement>('[name=guestPhone]')?.focus(); return; }
    setBusy(true); setError('');
    try {
      const saved = await api('checkout-contact', { email, phone, emailOptIn, textConsent });
      onSaved(saved.contact as SavedContact);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  return <>
    <form className={'store-form ' + styles.form} onSubmit={submit} noValidate aria-busy={busy}>
      <h2>Contact</h2>
      <label className="field"><span>Email address</span><input name="guestEmail" type="email" required autoComplete="email" inputMode="email" defaultValue={prefill.email} maxLength={200} aria-describedby={error ? id + '-error' : undefined}/></label>
      <label className="field"><span>Mobile number</span><input name="guestPhone" type="tel" required autoComplete="tel" inputMode="tel" defaultValue={prefill.phone} maxLength={20} aria-describedby={id + '-help' + (error ? ' ' + id + '-error' : '')}/></label>
      <p id={id + '-help'} className={styles.help}>{CHECKOUT_PHONE_HELP}</p>
      <div className={styles.boxes}>
        <Check checked={emailOptIn} onChange={setEmailOptIn}>{CHECKOUT_EMAIL_OPTIN_TEXT}</Check>
        <Check checked={textConsent} onChange={setTextConsent}>{CHECKOUT_TEXT_CONSENT_LABEL}<small className={styles.note}>{CHECKOUT_TEXT_CONSENT_NOTE}</small></Check>
      </div>
      {error && <p id={id + '-error'} className={styles.error} role="alert">{error}</p>}
      <button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : contact?.complete ? 'Save and continue' : 'Continue to delivery'}</button>
      <p className="muted">No membership needed. Already a member? <a href="/login?returnTo=%2Fcheckout">Sign in</a></p>
    </form>
    {!contact?.complete && <h2 className={styles.later} aria-hidden="true">Delivery address</h2>}
  </>;
}
