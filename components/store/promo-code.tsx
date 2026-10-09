'use client';

import { FormEvent, useId, useRef, useState } from 'react';
import { money } from '@/lib/catalog';
import { api, useStore } from './provider';
import styles from './promo-code.module.css';

type Props = {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onChange?: () => void;
};

export function PromoCode({ disabled = false, onBusyChange, onChange }: Props) {
  const { store, refresh } = useStore();
  const id = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operation = useRef(false);
  const applied = store.totals?.promo;

  async function update(nextCode: string) {
    if (disabled || operation.current || needsRefresh) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    onBusyChange?.(true);
    let changed = false;
    let refreshed = false;
    try {
      await api('promo', { code: nextCode });
      changed = true;
      onChange?.();
      await refresh();
      refreshed = true;
      setCode('');
      setMessage(nextCode ? 'Promo code applied.' : 'Promo code removed.');
    } catch (e) {
      if (changed) {
        setNeedsRefresh(true);
        setError('Your code was saved, but updated totals could not load. Reload totals before continuing.');
      } else {
        setError(e instanceof Error ? e.message : 'The promo code could not be applied. Please try again.');
        // A lost response may follow a saved code; reconcile before unlocking checkout.
        try { await refresh(); refreshed = true; }
        catch {
          setNeedsRefresh(true);
          setError('Your promo code could not be confirmed. Reload totals before continuing.');
        }
      }
    } finally {
      operation.current = false;
      setBusy(false);
      // Unconfirmed mutations and failed refreshes must not leave stale totals payable.
      if (refreshed) onBusyChange?.(false);
    }
  }

  async function reloadTotals() {
    if (disabled || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    onBusyChange?.(true);
    try {
      await refresh();
      onChange?.();
      setNeedsRefresh(false);
      setCode('');
      setMessage('Order totals updated.');
      onBusyChange?.(false);
    } catch {
      setError('Updated totals are still unavailable. Please reload totals before continuing.');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) { setError('Enter a promo code.'); return; }
    void update(code.trim());
  }

  return <div className={styles.promo} aria-busy={busy}>
    {applied && <div className={styles.applied}>
      <p role="status"><strong>{applied.code}</strong> applied. You save {money(applied.savings)}.</p>
      <button type="button" className={styles.remove} disabled={disabled || busy || needsRefresh} onClick={() => void update('')} aria-label={'Remove promo code ' + applied.code}>Remove</button>
    </div>}
    <details className={styles.disclosure}>
      <summary>Have a promo code?</summary>
      <form onSubmit={submit} className={styles.form}>
        <label htmlFor={id}>Promo code</label>
        <div className={styles.entry}>
          <input id={id} name="promoCode" value={code} onChange={event => { setCode(event.target.value); setError(''); setMessage(''); }} disabled={disabled || busy || needsRefresh} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={64} aria-invalid={Boolean(error)} aria-describedby={error ? id + '-error' : undefined}/>
          <button type="submit" className={styles.apply} disabled={disabled || busy || needsRefresh}>{busy ? 'Updating…' : 'Apply'}</button>
        </div>
      </form>
    </details>
    {error && <p id={id + '-error'} className={styles.error} role="alert">{error}</p>}
    {needsRefresh && <button type="button" className={styles.retry} disabled={disabled || busy} onClick={() => void reloadTotals()}>{busy ? 'Reloading…' : 'Reload totals'}</button>}
    {message && !error && <p className={styles.message} role="status">{message}</p>}
  </div>;
}
