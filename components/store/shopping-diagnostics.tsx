'use client';

import { useEffect, useState } from 'react';
import { ReportPeriodControls, useReportPeriod } from './report-period';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { ShoppingReport, ShoppingStage, ShoppingStageCount } from '@/lib/shopping-metrics';
import styles from './traffic-diagnostics.module.css';

const labels: Record<ShoppingStage, [string, string]> = {
  cart_add_confirmed: ['Cart additions confirmed', 'One successful add operation, including a pack or reorder.'],
  cart_view: ['Cart views', 'A ready, nonempty cart was shown.'],
  checkout_signin_view: ['Checkout sign-in screens', 'Checkout required the shopper to sign in.'],
  checkout_form_view: ['Checkout forms shown', 'The signed-in shopper could enter delivery details.'],
  delivery_quote_confirmed: ['Delivery quotes confirmed', 'A current delivery and tax quote became available.'],
  checkout_handoff_ready: ['Payment handoffs ready', 'The store returned a payment URL; this is not payment confirmation.'],
};
const count = (value: number) => value.toLocaleString('en-US');
const time = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not recorded';
const previousDate = (value: string) => new Date(Date.parse(value) - 1).toISOString().slice(0, 10);
const requestedStart = (end: string, days: number) => new Date(Date.parse(end) - days * 86400000).toISOString().slice(0, 10);
function stageTable(rows: ShoppingStageCount[]) {
  return <Table><TableHeader><TableRow><TableHead>Shopping stage</TableHead><TableHead className={styles.number}>Events</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.stage}><TableCell><strong>{labels[row.stage][0]}</strong><div>{labels[row.stage][1]}</div></TableCell><TableCell className={styles.number}>{count(row.events)}</TableCell></TableRow>)}</TableBody></Table>;
}
export function ShoppingDiagnostics() {
  const period = useReportPeriod();
  const [loadedKey, setLoadedKey] = useState('');
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<ShoppingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const key = period.query + ':' + revision;
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setReport(null);
    const controller = new AbortController();
    fetch('/api/metrics/shopping-report?' + period.query, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) { const detail = response.status === 400 ? await response.json() as { error?: string } : null; throw new Error(detail?.error || 'Report unavailable'); } return await response.json() as ShoppingReport; })
      .then(value => { if (active) { setReport(value); setLoadedKey(key); } })
      .catch(e => { if (active) setError('Shopping-stage diagnostics could not load. Totals are unavailable. ' + (e instanceof Error ? e.message : 'Please refresh to try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [period.query, revision]);
  function refresh() { setLoading(true); setError(''); setReport(null); setRevision(value => value + 1); }
  const visible = !loading && !error && report && loadedKey === key ? report : null;
  const available = visible?.status === 'available' ? visible : null;
  const hasCompleted = Boolean(available && available.completedDays.length && available.totals.events !== null);
  return <section className={styles.report} aria-labelledby="shopping-diagnostics-title">
    <h2 id="shopping-diagnostics-title">Shopping stages</h2>
    <p>Accepted events from eligible-product carts in live checkout. These counts are not linked to individual shoppers, page-view sources or orders. They do not establish conversion or abandonment rates.</p>
    <div className={styles.toolbar}>
      <ReportPeriodControls control={period} periods={['7', '30', '90']} label="Shopping reporting period"/>
      <button type="button" className="button button-dark" disabled={loading} onClick={refresh}>{loading ? 'Loading stages…' : 'Refresh shopping stages'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading shopping-stage diagnostics…</p>}
    {visible && <>
      <p><strong>Shopping collection: {visible.configuration.enabled ? 'Enabled' : 'Disabled'}.</strong> Measurement start: {time(visible.configuration.startedAt)}. Refreshed {time(visible.asOf)}.</p>
      {!visible.configuration.enabled && <p className={styles.note}>New shopping events are not being recorded. {visible.configuration.reason === 'flag_disabled' ? 'Collection is switched off.' : visible.configuration.reason === 'start_in_future' ? 'The configured start is in the future.' : 'A valid shopping measurement start has not been configured.'} Available historical counts remain separate.</p>}
      <p>Requested dates: {visible.window.requestedFrom ?? requestedStart(visible.window.endExclusive, visible.window.requestedDays)} through {visible.window.requestedTo ?? previousDate(visible.window.endExclusive)} ({visible.window.timeZone}). Today is excluded from period totals.</p>
      {visible.window.aggregation === 'minute' && <p className={styles.note}>Local-day totals use anonymous minute counts. {visible.window.preciseFrom ? <>Precise coverage began {time(visible.window.preciseFrom)}.</> : <>Precise coverage has not started.</>} Earlier local dates are unavailable, not zero activity; historical UTC totals cannot be converted to this time zone.</p>}
      {visible.status === 'unavailable' && <p role="alert">Shopping-stage data is unavailable. Missing history is not reported as zero.</p>}
      {available && <>
        <section aria-labelledby="shopping-complete-title"><h3 id="shopping-complete-title">Complete {visible.window.timeZone} days</h3>
          {hasCompleted ? <>
            <p>{available.completedDays.length} complete {available.completedDays.length === 1 ? 'day' : 'days'}: {available.completedDays[0].date} through {available.completedDays[available.completedDays.length - 1].date} ({visible.window.timeZone}).</p>
            {available.completedDays.length < available.window.requestedDays && <p className={styles.note}>Coverage is shorter than the requested period because of activation or retention. Partial coverage days are excluded; unavailable earlier dates are not zero activity.</p>}
            {stageTable(available.totals.byStage)}
            <p>Each row counts events independently. One person can appear in several rows or repeat an action. Zero means no accepted events were recorded, not proof of no activity or uninterrupted collection.</p>
            <details className={styles.detail}><summary>Daily accepted shopping-stage totals</summary>
              <Table><TableHeader><TableRow><TableHead>Day ({visible.window.timeZone})</TableHead><TableHead className={styles.number}>All stage events</TableHead><TableHead>UTC daily limit</TableHead></TableRow></TableHeader><TableBody>{available.completedDays.map(day => <TableRow key={day.date}><TableCell>{day.date}</TableCell><TableCell className={styles.number}>{count(day.events)}</TableCell><TableCell>{day.capReached ? 'Reached; additional events excluded' : 'Not reached'}</TableCell></TableRow>)}</TableBody></Table>
            </details>
          </> : <p>No complete measured {visible.window.timeZone} days are available in this period yet. This is unavailable history, not zero shopping activity.</p>}
        </section>
        {(available.activationDayPartial || available.partialToday) && <section aria-labelledby="shopping-partial-title"><h3 id="shopping-partial-title">Partial days, excluded from period totals</h3>
          {available.activationDayPartial && <details className={styles.detail}><summary>First partial coverage day: {available.activationDayPartial.date} ({visible.window.timeZone}){available.activationDayPartial.capReached ? ' (daily limit reached)' : ''}</summary>{stageTable(available.activationDayPartial.byStage)}</details>}
          {available.partialToday && <details className={styles.detail}><summary>Today so far: {available.partialToday.date} ({visible.window.timeZone}){available.partialToday.capReached ? ' (daily limit reached)' : ''}</summary>{stageTable(available.partialToday.byStage)}</details>}
        </section>}
      </>}
      <section aria-labelledby="shopping-limits-title"><h3 id="shopping-limits-title">Shopping collection limits</h3>
        <p>The separate shopping acceptance limit is {count(visible.cap.dailyLimit)} events per UTC day. {visible.status === 'unavailable' ? 'Limit status is unavailable without measured history.' : visible.cap.daysReached.length ? 'Limit reached on: ' + visible.cap.daysReached.join(', ') + ' UTC. Counts on those days are capped.' : 'No reported measured day has reached this limit.'} Shopping events do not consume the page-view limit.</p>
        <p>Retained from {visible.window.retainedFrom} UTC, up to {visible.cleanup.retentionDays} dates including today. Both measurement tables are cleaned together on recording, protected report reads and the daily scheduled sweep.</p>
        <p>Cleanup: <strong>{visible.cleanup.status === 'ok' ? 'Last attempt succeeded' : visible.cleanup.status === 'failed' ? 'Last attempt failed' : 'No attempt recorded'}</strong>. Last attempt: {time(visible.cleanup.lastAttemptAt)}. Last success: {time(visible.cleanup.lastSuccessAt)}. Last recorded failure: {time(visible.cleanup.lastFailureAt)}.</p>
        {visible.cleanup.status === 'failed' && <p role="alert">Retention cleanup needs attention. An earlier successful sweep does not confirm the latest one succeeded.</p>}
        <ul className={styles.limitations}>{visible.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </section>
    </>}
  </section>;
}
