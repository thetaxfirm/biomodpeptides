'use client';

import { useEffect, useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { TrafficReport, TrafficPageGroup, TrafficSourceGroup } from '@/lib/traffic-metrics';
import styles from './traffic-diagnostics.module.css';

const pageNames: Record<TrafficPageGroup, string> = { home: 'Home', catalog: 'Catalog and packs', product: 'Reviewed product pages', documents: 'Batch document library', guide: 'Guides and FAQs', about: 'About Biomod', locations: 'Locations', contact: 'Contact and partnerships', policy: 'Policies' };
const sourceNames: Record<TrafficSourceGroup, string> = { search: 'Search site', ai: 'AI site', social: 'Social site', external_other: 'Other referring site', internal: 'Internal navigation', direct_or_unavailable: 'Direct or unavailable' };
const time = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Not recorded';
const date = (value: string) => value.slice(0, 10);
const previousDate = (value: string) => new Date(Date.parse(value) - 1).toISOString().slice(0, 10);
const requestedStart = (endExclusive: string, days: number) => new Date(Date.parse(endExclusive) - days * 86400000).toISOString().slice(0, 10);
const count = (value: number) => value.toLocaleString('en-US');

export function TrafficDiagnostics() {
  const [days, setDays] = useState('7');
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<TrafficReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null);
    fetch('/api/metrics/report?days=' + days, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Report unavailable');
        return await response.json() as TrafficReport;
      })
      .then(value => { if (active) setReport(value); })
      .catch(() => { if (active) setError('Traffic diagnostics could not load. Totals are unavailable. Please refresh to try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [days, revision]);
  function refresh() { setLoading(true); setError(''); setReport(null); setRevision(value => value + 1); }
  const visible = !loading && !error && report && String(report.window.requestedDays) === days ? report : null;
  const available = visible?.status === 'available' ? visible : null;
  const hasCompleted = Boolean(available && available.completedDays.length && available.totals.events !== null);
  return <section className={styles.report} aria-labelledby="traffic-diagnostics-title">
    <h2 id="traffic-diagnostics-title">Traffic diagnostics</h2>
    <p>Accepted public page-view events. These are not unique visitors, verified people, conversions or attributable sales.</p>
    <div className={styles.toolbar}>
      <label className={styles.period}>Reporting period<select value={days} onChange={event => { setLoading(true); setError(''); setReport(null); setDays(event.target.value); }}>
        <option value="7">Last 7 complete days (UTC)</option><option value="30">Last 30 complete days (UTC)</option>
      </select></label>
      <button type="button" className="button button-dark" disabled={loading} onClick={refresh}>{loading ? 'Loading totals…' : 'Refresh totals'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading traffic diagnostics…</p>}
    {visible && <>
      <p><strong>Collection: {visible.configuration.enabled ? 'Enabled' : 'Disabled'}.</strong> Measurement start: {time(visible.configuration.startedAt)}. Refreshed {time(visible.asOf)}.</p>
      {!visible.configuration.enabled && <p className={styles.note}>New events are not being recorded. {visible.configuration.reason === 'flag_disabled' ? 'Collection is switched off.' : visible.configuration.reason === 'start_in_future' ? 'The configured start is in the future.' : 'A valid measurement start has not been configured.'} Any available historical totals are retained separately.</p>}
      <p>Requested dates: {requestedStart(visible.window.endExclusive, visible.window.requestedDays)} through {previousDate(visible.window.endExclusive)} UTC. Today is excluded from period totals.</p>
      {visible.status === 'unavailable' && <p role="alert">Traffic data is unavailable. No event totals are being reported as zero.</p>}
      {available && <>
        <section aria-labelledby="traffic-complete-title">
          <h3 id="traffic-complete-title">Complete UTC days</h3>
          {hasCompleted ? <>
            <p><strong>{count(available.totals.events!)} accepted page-view events</strong> across {available.completedDays.length} complete {available.completedDays.length === 1 ? 'day' : 'days'}: {available.completedDays[0].date} through {available.completedDays[available.completedDays.length - 1].date} UTC.</p>
            {available.completedDays.length < available.window.requestedDays && <p className={styles.note}>Coverage is shorter than the requested period. Dates before activation are unavailable; the partial activation day is excluded from these totals.</p>}
            <p>Zero means no accepted events were recorded for that bucket. It does not establish that nobody visited or that collection was uninterrupted.</p>
            <div className={styles.breakdowns}>
              <section aria-labelledby="traffic-source-title"><h4 id="traffic-source-title">Referrer categories</h4>
                <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead className={styles.number}>Events</TableHead></TableRow></TableHeader><TableBody>{available.totals.bySourceGroup.map(row => <TableRow key={row.sourceGroup}><TableCell>{sourceNames[row.sourceGroup]}</TableCell><TableCell className={styles.number}>{count(row.events)}</TableCell></TableRow>)}</TableBody></Table>
              </section>
              <section aria-labelledby="traffic-page-title"><h4 id="traffic-page-title">Page categories</h4>
                <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead className={styles.number}>Events</TableHead></TableRow></TableHeader><TableBody>{available.totals.byPageGroup.map(row => <TableRow key={row.pageGroup}><TableCell>{pageNames[row.pageGroup]}</TableCell><TableCell className={styles.number}>{count(row.events)}</TableCell></TableRow>)}</TableBody></Table>
              </section>
            </div>
            <p>A referrer category reflects a known referring hostname, not a search query or proven acquisition. Missing referrers can include search engines, AI apps or direct navigation. Later navigation within the same document is classified as internal.</p>
            <details className={styles.detail}><summary>Daily accepted event totals</summary>
              <Table><TableHeader><TableRow><TableHead>Day (UTC)</TableHead><TableHead className={styles.number}>Events</TableHead><TableHead>Daily limit</TableHead></TableRow></TableHeader><TableBody>{available.completedDays.map(day => <TableRow key={day.date}><TableCell>{day.date}</TableCell><TableCell className={styles.number}>{count(day.events)}</TableCell><TableCell>{day.capReached ? 'Reached; additional events excluded' : 'Not reached'}</TableCell></TableRow>)}</TableBody></Table>
            </details>
          </> : <p>No complete measured UTC days are available in this period yet. This is unavailable history, not zero traffic.</p>}
        </section>
        {(available.activationDayPartial || available.partialToday) && <section aria-labelledby="traffic-partial-title"><h3 id="traffic-partial-title">Partial days, excluded from period totals</h3>
          <Table><TableHeader><TableRow><TableHead>Day (UTC)</TableHead><TableHead>Coverage</TableHead><TableHead className={styles.number}>Events</TableHead></TableRow></TableHeader><TableBody>
            {available.activationDayPartial && <TableRow><TableCell>{available.activationDayPartial.date}</TableCell><TableCell>Activation day, since measurement began{available.activationDayPartial.capReached ? '; daily limit reached' : ''}</TableCell><TableCell className={styles.number}>{count(available.activationDayPartial.events)}</TableCell></TableRow>}
            {available.partialToday && <TableRow><TableCell>{available.partialToday.date}</TableCell><TableCell>Today so far{available.partialToday.capReached ? '; daily limit reached' : ''}</TableCell><TableCell className={styles.number}>{count(available.partialToday.events)}</TableCell></TableRow>}
          </TableBody></Table>
        </section>}
      </>}
      <section aria-labelledby="traffic-limits-title"><h3 id="traffic-limits-title">Collection limits and retention</h3>
        <p>The daily acceptance limit is {count(visible.cap.dailyLimit)} events. {visible.status === 'unavailable' ? 'Limit status is unavailable without measured history.' : visible.cap.daysReached.length ? 'Limit reached on: ' + visible.cap.daysReached.join(', ') + ' UTC. Totals on those days are capped.' : 'No reported measured day has reached the limit.'} This limit does not prevent all bots or request costs.</p>
        <p>Retained date window: {date(visible.window.retainedFrom)} onward, up to {visible.cleanup.retentionDays} UTC dates including today. Old buckets are removed on recording, report reads and the scheduled daily cleanup; removal is not instantaneous at midnight.</p>
        <p>Cleanup: <strong>{visible.cleanup.status === 'ok' ? 'Last attempt succeeded' : visible.cleanup.status === 'failed' ? 'Last attempt failed' : 'No attempt recorded'}</strong>. Last attempt: {time(visible.cleanup.lastAttemptAt)}. Last success: {time(visible.cleanup.lastSuccessAt)}. Last recorded failure: {time(visible.cleanup.lastFailureAt)}.</p>
        {visible.cleanup.status === 'failed' && <p role="alert">Retention cleanup needs attention. A successful previous cleanup does not confirm the latest cleanup succeeded.</p>}
        <ul className={styles.limitations}>{visible.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </section>
    </>}
  </section>;
}
