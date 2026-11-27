'use client';

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { EMAIL_CONSENT_TEXT, EMAIL_OFFER_ARM_MS, EMAIL_OFFER_AWAY_MS, EMAIL_OFFER_CART_QUIET_MS, EMAIL_OFFER_DONE, EMAIL_OFFER_EXIT_HOLD_MS, EMAIL_OFFER_LEAD, EMAIL_OFFER_QUIET_MS, EMAIL_OFFER_TITLE, emailOfferBlockedPath, flickedUp, type ScrollSample } from '@/lib/email-offer-wording';
import { api, useStore } from './provider';
import styles from './email-offer.module.css';

// Owner, Nov 27 2026: ask a visitor who is leaving for an email to hear about deals and secret sales.
// No discount code. Never while they are shopping: the first version opened 40 seconds into a phone
// visit and landed on people pressing Add to cart.
//  - Pointer screens: the cursor leaves through the top of the window and stays out.
//  - Touch screens, empty cart only: a fast flick back to the top after reading down the page, or
//    coming back after switching to another app or tab. The back button is never intercepted.
//  - Never within 30 seconds of a cart change, while typing, or while a menu or dialog is open.
// Once per visit, and away for 30 days in that browser after it is closed.
const QUIET_KEY = 'bm-email-offer-quiet', SEEN_KEY = 'bm-email-offer-seen', CART_KEY = 'bm-email-offer-cart';
const read = (store: Storage | undefined, key: string) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
const write = (store: Storage | undefined, key: string, value: string) => { try { store?.setItem(key, value); } catch { /* private mode: the panel simply may show again */ } };
const local = () => (typeof window === 'undefined' ? undefined : window.localStorage);
const session = () => (typeof window === 'undefined' ? undefined : window.sessionStorage);
const quiet = (ms: number) => write(local(), QUIET_KEY, String(Date.now() + ms));
const resting = () => Boolean(read(session(), SEEN_KEY)) || Number(read(local(), QUIET_KEY) || 0) > Date.now();
const pointerScreen = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// When the cart last changed, kept for the visit: each page is a fresh load, and a cart change on the
// last page still counts on this one.
const cartChanged = () => write(session(), CART_KEY, String(Date.now()));
const cartQuiet = () => Date.now() - Number(read(session(), CART_KEY) || 0) >= EMAIL_OFFER_CART_QUIET_MS;

/** The visitor is typing, or a menu, picker or another dialog is open. */
function occupied(): boolean {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && (['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName) || focused.isContentEditable)) return true;
  return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]')].some(node => node.getClientRects().length > 0);
}

export function EmailOffer() {
  const { store, ready, cartUpdating, refresh } = useStore();
  const path = usePathname() || '/';
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const eligible = ready && !store.customer && !store.guest && !store.contact?.email && !store.admin && !emailOfferBlockedPath(path);

  // The cart as last seen. Loading a page is not a change; adding, removing or re-counting is.
  const cartKey = JSON.stringify(store.cart);
  const cart = useRef<{ key: string | null; empty: boolean; eligible: boolean }>({ key: null, empty: true, eligible: false });
  useEffect(() => {
    if (!ready) return;
    if (cart.current.key !== null && cart.current.key !== cartKey) cartChanged();
    cart.current.key = cartKey;
  }, [ready, cartKey]);
  useEffect(() => { if (cartUpdating) cartChanged(); }, [cartUpdating]);
  useEffect(() => { cart.current.empty = store.cart.length === 0; cart.current.eligible = eligible; }, [store.cart.length, eligible]);

  const show = useCallback((touch: boolean) => {
    const now = cart.current;
    if (!now.eligible || resting() || !cartQuiet() || (touch && !now.empty) || occupied()) return;
    write(session(), SEEN_KEY, '1');
    setOpen(true);
  }, []);

  // Pointer screens: leaving through the top, and staying out.
  useEffect(() => {
    if (!eligible || open || resting() || !pointerScreen()) return;
    let armed = false, hold = 0;
    const arm = window.setTimeout(() => { armed = true; }, EMAIL_OFFER_ARM_MS);
    const leave = (event: MouseEvent) => {
      if (!armed || event.relatedTarget || event.clientY > 0) return;
      window.clearTimeout(hold);
      hold = window.setTimeout(() => show(false), EMAIL_OFFER_EXIT_HOLD_MS);
    };
    const back = () => window.clearTimeout(hold);
    document.documentElement.addEventListener('mouseout', leave);
    document.documentElement.addEventListener('mouseover', back);
    return () => { window.clearTimeout(arm); window.clearTimeout(hold); document.documentElement.removeEventListener('mouseout', leave); document.documentElement.removeEventListener('mouseover', back); };
  }, [eligible, open, show]);

  // Touch screens: a fast flick back to the top, or a return from another app or tab.
  useEffect(() => {
    if (!eligible || open || resting() || pointerScreen()) return;
    let samples: ScrollSample[] = [], deepest = window.scrollY, hiddenAt = 0, wait = 0;
    const scrolled = () => {
      const sample = { t: performance.now(), y: window.scrollY };
      deepest = Math.max(deepest, sample.y);
      samples = [...samples.filter(s => sample.t - s.t <= 350), sample];
      if (flickedUp(samples, window.innerHeight, deepest)) { samples = []; show(true); }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      // A moment for the page to settle, so the panel does not land mid-repaint.
      if (away >= EMAIL_OFFER_AWAY_MS) { window.clearTimeout(wait); wait = window.setTimeout(() => show(true), 800); }
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearTimeout(wait); window.removeEventListener('scroll', scrolled); document.removeEventListener('visibilitychange', visibility); };
  }, [eligible, open, path, show]);

  // A visitor who signs in or reaches checkout while it is open never sees it there.
  const visible = open && (done || eligible);
  useEffect(() => {
    const node = dialog.current;
    if (!node || !visible || node.open) return;
    const sheet = window.matchMedia('(max-width: 640px)').matches;
    if (sheet) node.show(); else node.showModal();
    if (!sheet) node.querySelector<HTMLInputElement>('input[type=email]')?.focus();
  }, [visible]);

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
      await api('email-offer', { email: email.trim(), consent: true, path, company: trap });
      quiet(365 * 24 * 3600000);
      setDone(true);
      // The store now knows this visitor's email, so checkout starts with it filled in.
      void refresh().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  if (!visible) return null;
  return <dialog ref={dialog} className={styles.panel} aria-labelledby={id + '-title'} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className={styles.inner}>
      <button type="button" className={styles.close} onClick={close} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 1.5l11 11m0-11l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
      </button>
      {done ? <div role="status">
        <h2 id={id + '-title'} className={styles.title}>You&rsquo;re on the list</h2>
        <p className={styles.lead}>{EMAIL_OFFER_DONE}</p>
        <button type="button" className={styles.action} onClick={close}>Continue shopping</button>
      </div> : <>
        <h2 id={id + '-title'} className={styles.title}>{EMAIL_OFFER_TITLE}</h2>
        <p className={styles.lead}>{EMAIL_OFFER_LEAD}</p>
        <form onSubmit={submit} className={styles.form} noValidate>
          <label htmlFor={id + '-email'} className={styles.hidden}>Email address</label>
          <input id={id + '-email'} type="email" name="email" autoComplete="email" inputMode="email" placeholder="Email address" value={email} maxLength={254}
            onChange={event => { setEmail(event.target.value); setError(''); }} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={id + '-terms' + (error ? ' ' + id + '-error' : '')}/>
          <input name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className={styles.trap}/>
          <button type="submit" className={styles.action} disabled={busy}>{busy ? 'One moment…' : 'Sign me up'}</button>
        </form>
        {error && <p id={id + '-error'} className={styles.error} role="alert">{error}</p>}
        <p id={id + '-terms'} className={styles.terms}>{EMAIL_CONSENT_TEXT}</p>
      </>}
    </div>
  </dialog>;
}
