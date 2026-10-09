'use client';

import { useEffect, useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { PromoAnalyticsReport } from '@/lib/promo-analytics';
import { promoAnalyticsExport } from '@/lib/promo-analytics-export';
import { money } from '@/lib/catalog';
import { api } from './provider';
import styles from './promo-analytics.module.css';

type Environment = 'live' | 'sandbox' | 'unknown';
const environmentNames: Record<Environment, string> = { live: 'Live', sandbox: 'Sandbox', unknown: 'Unknown' };
const utcTime = (value: number) => new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function PromoAnalytics() {
  const [days, setDays] = useState('30');
  const [environment, setEnvironment] = useState<Environment>('live');
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<PromoAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let active = true;
    api('admin-promos?days=' + days).then((value: PromoAnalyticsReport) => {
      if (active) { setReport(value); setError(''); }
    }).catch(() => {
      if (active) { setReport(null); setError('Promo analytics could not load. Please refresh to try again.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, revision]);

  function clearReport() { setReport(null); setLoading(true); setError(''); setDownloadError(''); }
  function refreshReport() { clearReport(); setRevision(value => value + 1); }
  function downloadReport() {
    if (!report || loading || error) return;
    setDownloadError('');
    try {
      const file = promoAnalyticsExport(report);
      const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = file.filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch { setDownloadError('The CSV download could not start. Please try again.'); }
  }

  const visible = !loading && !error && report && String(report.window.days) === days ? report : null;
  const missingPayments = visible?.codes.reduce((sum, code) => sum + (code.rows.find(row => row.environment === environment)?.missingPaymentRecords ?? 0), 0) ?? 0;
  const missingAmounts = visible?.codes.reduce((sum, code) => sum + (code.rows.find(row => row.environment === environment)?.missingAmountRecords ?? 0), 0) ?? 0;
  const missingDiscounts = visible?.codes.reduce((sum, code) => sum + (code.rows.find(row => row.environment === environment)?.missingDiscountRecords ?? 0), 0) ?? 0;

  return <section className={styles.report} aria-labelledby="promo-analytics-title">
    <h2 id="promo-analytics-title">Promo code performance</h2>
    <p>Orders with a saved promo code, separated by payment environment.</p>
    <div className={styles.toolbar}>
      <label className={styles.control}>Reporting period<select value={days} onChange={event => { clearReport(); setDays(event.target.value); }}>
        <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All available history</option>
      </select></label>
      <label className={styles.control}>Payment environment<select value={environment} onChange={event => setEnvironment(event.target.value as Environment)}>
        {Object.entries(environmentNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button type="button" className="button button-dark" disabled={loading} onClick={refreshReport}>{loading ? 'Loading totals…' : 'Refresh totals'}</button>
      <button type="button" className="text-button" disabled={!visible} onClick={downloadReport}>Download CSV</button>
    </div>
    <p className={styles.note}>Periods use UTC and include today’s partial day. CSV includes all environments in separate rows.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {downloadError && <p className={styles.error} role="alert">{downloadError}</p>}
    {loading && <p role="status">Loading promo analytics…</p>}
    {visible && <>
      <p className={styles.note}>Order-start window: {visible.window.days === 'all' ? 'all available history' : utcTime(visible.window.start)} to {utcTime(visible.window.end)}. Refreshed {utcTime(visible.asOf)}.</p>
      <h3>{environmentNames[environment]} orders</h3>
      {visible.codes.length ? <Table>
        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead className={styles.number}>Current discount</TableHead><TableHead className={styles.number}>Orders started</TableHead><TableHead className={styles.number}>Payment recorded</TableHead><TableHead className={styles.number}>Promo savings on paid orders</TableHead><TableHead className={styles.number}>Recorded gross</TableHead></TableRow></TableHeader>
        <TableBody>{visible.codes.map(code => {
          const row = code.rows.find(row => row.environment === environment);
          return <TableRow key={code.code}>
            <TableCell><strong className={styles.code}>{code.code}</strong><span className={styles.codeStatus}>{code.active ? 'Active' : 'Inactive'}</span></TableCell>
            <TableCell className={styles.number}>{code.percentOff === null ? 'Not recorded' : code.percentOff + '%'}</TableCell>
            <TableCell className={styles.number}>{row ? row.orders : 'Unavailable'}</TableCell>
            <TableCell className={styles.number}>{row ? row.paymentRecorded : 'Unavailable'}</TableCell>
            <TableCell className={styles.number}>{row ? row.paymentRecorded > 0 && row.missingDiscountRecords === row.paymentRecorded ? 'Not recorded' : money(row.discountCents) : 'Unavailable'}</TableCell>
            <TableCell className={styles.number}>{row ? row.paymentRecorded > 0 && row.missingAmountRecords === row.paymentRecorded ? 'Not recorded' : money(row.grossCents) : 'Unavailable'}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table> : <p>No promo codes are recorded for this period.</p>}
      {missingPayments > 0 && <p className="notice">{missingPayments} {missingPayments === 1 ? 'order lacks' : 'orders lack'} complete payment references and {missingPayments === 1 ? 'is' : 'are'} excluded from payment-recorded totals.</p>}
      {missingAmounts > 0 && <p className="notice">{missingAmounts} paid {missingAmounts === 1 ? 'order lacks' : 'orders lack'} a valid gross amount. Recorded gross excludes those amounts and may be incomplete.</p>}
      {missingDiscounts > 0 && <p className="notice">{missingDiscounts} paid {missingDiscounts === 1 ? 'order lacks' : 'orders lack'} a complete promo discount record. The displayed savings exclude missing amounts.</p>}
      <div className={styles.notes}>
        <p>Counts measure orders with a saved code, not cart applications or unique visitors. Payment status is shown as of this refresh for orders started in the selected window; these are not daily payment cohorts.</p>
        <p>Payment recorded requires a paid or fulfillment status and complete payment and verification references. Gross includes shipping and tax before refunds. Promo savings cover payment-recorded orders only.</p>
        <p>Customer purchases and internal tests are currently unclassified. A live payment can still be an internal test.</p>
      </div>
    </>}
  </section>;
}
