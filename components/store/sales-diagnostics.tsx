'use client';
import { FinancialSummary } from './financial-summary';
import { useEffect, useState } from 'react';
import { ReportPeriodControls, useReportPeriod } from './report-period';
import { reportDateLabel } from '@/lib/report-window';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { DiagnosticEnvironment, SalesDiagnosticsReport } from '@/lib/sales-diagnostics';
import { salesDiagnosticsExport } from '@/lib/sales-diagnostics-export';
import { money } from '@/lib/catalog';
import { api } from './provider';
import styles from './sales-diagnostics.module.css';
const environments: DiagnosticEnvironment[] = ['live', 'sandbox', 'unknown'];
const environmentName = { live: 'Live', sandbox: 'Sandbox', unknown: 'Unknown' };
const statusName: Record<string, string> = { creating: 'Creating checkout', awaiting_payment: 'Awaiting payment', pending: 'Payment pending', review: 'Needs review', paid: 'Paid', labeling: 'Preparing shipment', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', failed: 'Failed', unknown: 'Unknown' };
const requestName = { quote: 'Delivery quotes issued', contact: 'Contact requests', stock: 'Stock notifications requested', affiliate: 'Partner applications' };
const utcTime = (value: number | null) => value === null ? 'None' : new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export function SalesDiagnostics() {
  const period = useReportPeriod();
  const [loadedKey, setLoadedKey] = useState('');
  const [revision, setRevision] = useState(0);
  const [response, setReport] = useState<SalesDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const key = period.query + ':' + revision;
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setReport(null);
    api('admin-diagnostics?' + period.query).then((value: SalesDiagnosticsReport) => {
      if (active) { setReport(value); setLoadedKey(key); }
    }).catch(e => { if (active) setError('Sales diagnostics could not load. ' + (e instanceof Error ? e.message : 'Please retry.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period.query, revision]);
  const report = loadedKey === key && !loading && !error ? response : null;
  function refreshTotals() { setLoading(true); setError(''); setReport(null); setRevision(n => n + 1); }
  function downloadReport() {
    if (!report || loading) return;
    try {
      const file = salesDiagnosticsExport(report);
      const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = file.filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch { setError('The CSV download could not start. Please retry.'); }
  }
  const missing = report?.orders.reduce((n, row) => n + row.missingPaymentRecords, 0) || 0;
  return <section className={styles.report} aria-labelledby="sales-diagnostics-title">
    <h2 id="sales-diagnostics-title">Sales diagnostics</h2>
    <p>Existing order and request records. These counts do not measure visitors, people or conversion rates.</p>
    <div className={styles.toolbar}>
      <ReportPeriodControls control={period} periods={['7', '30']} label="Reporting period"/>
      <button type="button" className="button button-dark" disabled={loading} onClick={refreshTotals}>{loading ? 'Loading totals…' : 'Refresh totals'}</button>
      <button type="button" className="text-button" disabled={loading || !report} onClick={downloadReport}>Download CSV</button>
    </div>
    <FinancialSummary query={period.query} revision={revision}/>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading sales diagnostics…</p>}
    {report && <>
      <p>Reporting dates: {reportDateLabel(report.window)}. Today is excluded. Refreshed {utcTime(report.asOf)}.</p>
      <section aria-labelledby="diagnostic-orders"><h3 id="diagnostic-orders">Orders started in this period</h3>
        <p>Payment status is shown as of this refresh. Orders explicitly marked as internal tests are excluded. Remaining orders are not independently classified; a live payment can still be a test.</p>
        <Table><TableHeader><TableRow><TableHead>Environment</TableHead><TableHead className={styles.number}>Orders started</TableHead><TableHead className={styles.number}>Payment recorded</TableHead><TableHead className={styles.number}>Recorded gross</TableHead></TableRow></TableHeader>
          <TableBody>{environments.map(environment => {
            const rows = report.orders.filter(row => row.environment === environment);
            return <TableRow key={environment}><TableCell>{environmentName[environment]}</TableCell><TableCell className={styles.number}>{rows.reduce((n, row) => n + row.orders, 0)}</TableCell><TableCell className={styles.number}>{rows.reduce((n, row) => n + row.paymentRecorded, 0)}</TableCell><TableCell className={styles.number}>{money(rows.reduce((n, row) => n + row.grossCents, 0))}</TableCell></TableRow>;
          })}</TableBody></Table>
        <p>Payment recorded requires a paid or fulfillment status plus both payment and verification references. Gross includes tax and shipping; it is not net revenue and does not account for refunds. This table groups orders by when checkout began. Payment-recording and provider-settlement date coverage appear in the financial record summary above.</p>
        {missing > 0 && <p className="notice">{missing} paid or fulfillment-status {missing === 1 ? 'order lacks' : 'orders lack'} complete payment references and {missing === 1 ? 'is' : 'are'} excluded from recorded payment totals.</p>}
        <details className={styles.detail}><summary>Daily order starts and current status</summary>
          {report.orders.length ? <Table><TableHeader><TableRow><TableHead>Started ({report.window.timeZone})</TableHead><TableHead>Environment</TableHead><TableHead>Current status</TableHead><TableHead className={styles.number}>Orders</TableHead></TableRow></TableHeader><TableBody>{report.orders.map(row => <TableRow key={[(row.day ?? row.dayUtc), row.environment, row.status].join(':')}><TableCell>{(row.day ?? row.dayUtc)}</TableCell><TableCell>{environmentName[row.environment]}</TableCell><TableCell>{statusName[row.status] || 'Unknown'}</TableCell><TableCell className={styles.number}>{row.orders}</TableCell></TableRow>)}</TableBody></Table> : <p>No orders started in this period.</p>}
        </details>
      </section>
      <section aria-labelledby="diagnostic-requests"><h3 id="diagnostic-requests">Recorded requests in this period</h3>
        <Table><TableHeader><TableRow><TableHead>Record type</TableHead><TableHead className={styles.number}>Records</TableHead></TableRow></TableHeader><TableBody>{(Object.keys(requestName) as (keyof typeof requestName)[]).map(kind => <TableRow key={kind}><TableCell>{requestName[kind]}</TableCell><TableCell className={styles.number}>{report.requests.filter(row => row.kind === kind).reduce((n, row) => n + row.records, 0)}</TableCell></TableRow>)}</TableBody></Table>
        <p>Recalculating delivery can issue multiple quotes for one account. Failed quotes are not recorded. These records cannot establish quote-to-purchase conversion or separate customer activity from internal tests.</p>
      </section>
      <section aria-labelledby="diagnostic-unresolved"><h3 id="diagnostic-unresolved">Currently unresolved records</h3>
        <p>All dates, including today. These are outstanding records, not confirmed abandoned checkouts or active shoppers.</p>
        {report.unresolvedOrders.length ? <Table><TableHeader><TableRow><TableHead>Environment</TableHead><TableHead>Current status</TableHead><TableHead className={styles.number}>Orders</TableHead><TableHead>Oldest start (UTC)</TableHead></TableRow></TableHeader><TableBody>{report.unresolvedOrders.map(row => <TableRow key={row.environment + ':' + row.status}><TableCell>{environmentName[row.environment]}</TableCell><TableCell>{statusName[row.status]}</TableCell><TableCell className={styles.number}>{row.records}</TableCell><TableCell>{utcTime(row.oldestCreated)}</TableCell></TableRow>)}</TableBody></Table> : <p>No unresolved payment records.</p>}
        <p>Unresolved cart choices: <strong>{report.cartConflicts.records}</strong>.{report.cartConflicts.records > 0 && <> Oldest started {utcTime(report.cartConflicts.oldestCreated)}.</>} A cart choice can remain unresolved after someone leaves the site.</p>
      </section>
    </>}
  </section>;
}
