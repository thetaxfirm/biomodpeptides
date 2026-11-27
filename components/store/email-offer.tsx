'use client';

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { EMAIL_CONSENT_TEXT, EMAIL_OFFER_PERCENT, EMAIL_OFFER_QUIET_MS, EMAIL_OFFER_TOUCH_DELAY_MS, emailOfferBlockedPath } from '@/lib/email-offer-wording';
import { api, useStore } from './provider';
import styles from './email-offer.module.css';

// Owner, Nov 27 2026: a visitor who is not signed in and is about to leave is asked for an email to
// hear about private sales, with a 10% code. Pointer screens: when the cursor leaves through the top
// of the window. Touch screens: after 40 seconds of browsing. Once a month at most per browser.
const QUIET_KEY = 'bm-email-offer-quiet', START_KEY = 'bm-email-offer-start', SEEN_KEY = 'bm-email-offer-seen';
const read = (store: Storage | undefined, key: string) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
const write = (store: Storage | undefined, key: string, value: string) => { try { store?.setItem(key, value); } catch { /* private mode: the panel simply may show again */ } };
const local = () => (typeof window === 'undefined' ? undefined : window.localStorage);
const session = () => (typeof window === 'undefined' ? undefined : window.sessionStorage);
const quiet = (ms: number) => write(local(), QUIET_KEY, String(Date.now() + ms));

export function EmailOffer() {
  const { store, ready, refresh } = useStore();
  const path = usePathname() || '/';
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ code: string; applied: boolean } | null>(null);
  const eligible = ready && !store.customer && !store.guest && !store.admin && !emailOfferBlockedPath(path);

  const show = useCallback(() => {
    if (read(session(), SEEN_KEY) || Number(read(local(), QUIET_KEY) || 0) > Date.now()) return;
    write(session(), SEEN_KEY, '1');
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!eligible || open || read(session(), SEEN_KEY) || Number(read(local(), QUIET_KEY) || 0) > Date.now()) return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      // Arm after a short read so a cursor passing the tab bar on arrival does not trigger it.
      let armed = false;
      const arm = window.setTimeout(() => { armed = true; }, 4000);
      const leave = (event: MouseEvent) => { if (armed && !event.relatedTarget && event.clientY <= 0) show(); };
      document.documentElement.addEventListener('mouseout', leave);
      return () => { window.clearTimeout(arm); document.documentElement.removeEventListener('mouseout', leave); };
    }
    // Touch: 40 seconds counted from the first page of this visit, across page changes.
    const start = Number(read(session(), START_KEY)) || Date.now();
    write(session(), START_KEY, String(start));
    const timer = window.setTimeout(show, Math.max(0, start + EMAIL_OFFER_TOUCH_DELAY_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [eligible, open, show]);

  useEffect(() => {
    const node = dialog.current;
    if (!node || !open || node.open || (!done && !eligible)) return;
    const sheet = window.matchMedia('(max-width: 640px)').matches;
    if (sheet) node.show(); else node.showModal();
    if (!sheet) node.querySelector<HTMLInputElement>('input[type=email]')?.focus();
  }, [open, done, eligible]);


  function close() {
    if (!done) quiet(EMAIL_OFFER_QUIET_MS);
    dialog.current?.close();
    setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    const trap = (event.currentTarget.elements.namedItem('company') as HTMLInputElement | null)?.value || '';
    setBusy(true); setError('');
    try {
      const result = await api('email-offer', { email: email.trim(), consent: true, path, company: trap });
      quiet(365 * 24 * 3600000);
      setDone({ code: result.code, applied: Boolean(result.applied) });
      if (result.applied) await refresh().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  // A visitor who signs in or reaches checkout while it is open never sees it there.
  if (!open || (!done && !eligible)) return null;
  return <dialog ref={dialog} className={styles.panel} aria-labelledby={id + '-title'} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className={styles.inner}>
      <button type="button" className={styles.close} onClick={close} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 1.5l11 11m0-11l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
      </button>
      {done ? <div role="status">
        <h2 id={id + '-title'} className={styles.title}>You&rsquo;re on the list</h2>
        <p className={styles.lead}>Your {EMAIL_OFFER_PERCENT}% code is <strong className={styles.code}>{done.code}</strong></p>
        <p className={styles.note}>{done.applied ? 'It is already applied to your cart.' : 'Enter it under “Have a promo code?” at checkout.'} Watch your inbox for private sales.</p>
        <button type="button" className={styles.action} onClick={close}>Continue shopping</button>
      </div> : <>
        <h2 id={id + '-title'} className={styles.title}>{EMAIL_OFFER_PERCENT}% off your first order</h2>
        <p className={styles.lead}>Plus first word on private sales and restocks.</p>
        <form onSubmit={submit} className={styles.form} noValidate>
          <label htmlFor={id + '-email'} className={styles.hidden}>Email address</label>
          <input id={id + '-email'} type="email" name="email" autoComplete="email" inputMode="email" placeholder="Email address" value={email} maxLength={254}
            onChange={event => { setEmail(event.target.value); setError(''); }} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={id + '-terms' + (error ? ' ' + id + '-error' : '')}/>
          <input name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className={styles.trap}/>
          <button type="submit" className={styles.action} disabled={busy}>{busy ? 'One moment…' : 'Get my code'}</button>
        </form>
        {error && <p id={id + '-error'} className={styles.error} role="alert">{error}</p>}
        <p id={id + '-terms'} className={styles.terms}>{EMAIL_CONSENT_TEXT}</p>
      </>}
    </div>
  </dialog>;
}
