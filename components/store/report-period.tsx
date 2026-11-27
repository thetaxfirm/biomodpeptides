'use client';
import { useEffect, useState } from 'react';
import { calendarReportWindow, reportTimeZone } from '@/lib/report-window';
import styles from './report-period.module.css';

export type ReportSelection = { period: string; timeZone: string; from: string; to: string };
const preference = 'biomod-report-time-zone';
const changed = 'biomod-report-time-zone-changed';
export function reportQuery(selection: ReportSelection, now = Date.now()): string {
  const { period, from, to } = selection, timeZone = reportTimeZone(selection.timeZone);
  if (period !== 'summary') calendarReportWindow(period === 'custom' ? null : period, now, { timeZone, ...(period === 'custom' ? { from, to } : {}) }, { defaultDays: 7, allowedDays: [7, 30, 90], allowAll: true });
  const params = new URLSearchParams({ timeZone });
  if (period === 'custom') { params.set('from', from); params.set('to', to); }
  else if (period !== 'summary') params.set('days', period);
  return params.toString();
}
export function useReportPeriod(initial = '7') {
  const [selection, setSelection] = useState<ReportSelection>({ period: initial, timeZone: 'UTC', from: '', to: '' });
  const [draft, setDraft] = useState<ReportSelection>(selection);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => { try { const timeZone = reportTimeZone(localStorage.getItem(preference)); setSelection(old => ({ ...old, timeZone })); setDraft(old => ({ ...old, timeZone })); } catch { /* A corrupt preference never prevents reporting. */ } };
    sync(); window.addEventListener('storage', sync); window.addEventListener(changed, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(changed, sync); };
  }, []);
  function apply(next = draft) {
    try {
      const normalized = { ...next, timeZone: reportTimeZone(next.timeZone) };
      reportQuery(normalized); setSelection(normalized); setDraft(normalized); setError('');
      try { localStorage.setItem(preference, normalized.timeZone); window.dispatchEvent(new Event(changed)); } catch { /* The selection still works with storage disabled. */ }
    } catch (e) { setError(e instanceof Error ? e.message : 'Check the reporting dates and time zone.'); }
  }
  function choose(period: string) {
    const next = { ...draft, period }; setDraft(next); setError('');
    if (period !== 'custom') apply(next);
  }
  // The applied selection was validated. A shared zone change can invalidate a custom end date;
  // the server returns the actionable date error rather than showing another period's totals.
  const params = new URLSearchParams({ timeZone: selection.timeZone });
  if (selection.period === 'custom') { params.set('from', selection.from); params.set('to', selection.to); }
  else if (selection.period !== 'summary') params.set('days', selection.period);
  return { selection, draft, setDraft, error, choose, apply, query: params.toString() };
}
export function ReportPeriodControls({ control, periods = ['7', '30'], label = 'Reporting period' }: { control: ReturnType<typeof useReportPeriod>; periods?: string[]; label?: string }) {
  const { draft, setDraft, choose, apply, error } = control;
  const zoneList = label.toLowerCase().replace(/[^a-z]+/g, '-') + '-zones';
  return <div className={styles.controls}>
    <label>{label}<select value={draft.period} onChange={event => choose(event.target.value)}>{periods.map(period => <option key={period} value={period}>{period === 'summary' ? 'Today, 7 and 30 days' : period === 'all' ? 'All history through yesterday' : `Last ${period} complete days`}</option>)}<option value="custom">Custom complete dates</option></select></label>
    {draft.period === 'custom' && <><label>First date<input type="date" value={draft.from} onChange={event => setDraft(old => ({ ...old, from: event.target.value }))}/></label><label>Last date (inclusive)<input type="date" value={draft.to} onChange={event => setDraft(old => ({ ...old, to: event.target.value }))}/></label></>}
    <label>Reporting time zone<input type="text" list={zoneList} autoComplete="off" spellCheck={false} value={draft.timeZone} onChange={event => setDraft(old => ({ ...old, timeZone: event.target.value }))}/></label>
    <button type="button" className="text-button" onClick={() => apply()}>Apply dates and time zone</button>
    <datalist id={zoneList}>{['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'].map(zone => <option key={zone} value={zone}/>)}</datalist>
    <p className={styles.help}>Custom dates and time-zone edits use Apply. Ranges include up to 366 complete days. The time zone is shared between reports on this browser.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
