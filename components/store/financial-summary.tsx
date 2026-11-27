'use client';
import { useEffect, useState } from 'react';
import { reportDateLabel } from '@/lib/report-window';
import type { FinancialReport } from '@/lib/admin-finance';
import { financialCsv } from '@/lib/admin-finance-export';
import { money } from '@/lib/catalog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import styles from './sales-diagnostics.module.css';
/** Shares the diagnostics selector; changing periods discards stale totals before the next read. */
export function FinancialSummary({ query = 'timeZone=UTC&days=7', revision = 0 }: { query?: string; revision?: number }) {
  const [state, setState] = useState<{ key: string; report?: FinancialReport; error?: string }>({ key: '' });
  const key = query + ':' + revision;
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => {
    setDownloadError('');
    const controller = new AbortController();
    fetch('/api/admin/finance?' + query, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const report = await response.json() as FinancialReport & { error?: string };if (!response.ok) throw Error(report.error || 'Financial totals could not load.');
      if (!controller.signal.aborted) setState({ key, report });
    }).catch(e => { if (!controller.signal.aborted) setState({ key, error: e instanceof Error ? e.message : 'Financial totals could not load.' }); });
    return () => controller.abort();
  }, [query, revision]);
  const report = state.key === key ? state.report : null, error = state.key === key ? state.error : '';
  function download() {
    if (!report) return;
    setDownloadError('');
    try { const file=financialCsv(report),url=URL.createObjectURL(new Blob([file.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);} }
    catch { setDownloadError('The financial CSV could not download. Try again.'); }
  }
  return <section aria-labelledby="financial-summary-title"><h3 id="financial-summary-title">Financial record summary</h3>
    <button type="button" className="text-button" disabled={!report} onClick={download}>Download financial CSV</button>{downloadError && <p role="alert">{downloadError}</p>}
    {error ? <p role="alert">{error} Use Refresh totals to retry.</p> : !report ? <p role="status">Loading financial records…</p> : <>
      <p>Live orders started {reportDateLabel(report.window)}. Today, sandbox and marked internal tests are excluded. Current evidence covers {report.liveOrders} orders; {report.recordedPaymentOrders} have a recorded payment.</p>
      <Table><TableHeader><TableRow><TableHead>Saved amount</TableHead><TableHead className={styles.number}>Known total</TableHead><TableHead className={styles.number}>Orders with amount</TableHead><TableHead className={styles.number}>Missing amount</TableHead></TableRow></TableHeader><TableBody>
        {([['gross','Recorded gross (tax & shipping included)'],['subtotal','Product subtotal'],['discount','Checkout discounts'],['tax','Tax charged'],['customerShipping','Shipping charged to customer'],['carrierCost','Purchased carrier labels']] as const).map(([field,label]) => <TableRow key={field}><TableCell>{label}</TableCell><TableCell className={styles.number}>{money(report.amounts[field].cents)}</TableCell><TableCell className={styles.number}>{report.amounts[field].knownOrders}</TableCell><TableCell className={styles.number}>{report.amounts[field].missingOrders}</TableCell></TableRow>)}
      </TableBody></Table>
      <p>Order amounts use current paid or fulfillment states with payment and verification references. {report.missingPaymentReferences} such orders lack those references. Carrier cost covers purchased labels across this live cohort, including cancelled orders; {report.carrierCoverage.withoutLabel} orders have no saved purchased label. Insurance, carrier adjustments, processing fees and product costs are not fully recorded. These figures do not establish profit.</p>
      <p>Checkout discounts are saved pack and promo discounts; sale prices are already reflected in product prices. Payment-recording dates are known for {report.paymentDates.knownOrders} recorded payments and unknown for {report.paymentDates.unknownOrders}. {report.paymentDates.recordedDuringWindow} were recorded during these dates; {report.paymentDates.recordedOutsideWindow} outside them. This is an order-start cohort, not a daily settlement report.</p>
      {report.providerSettlementDates && <p>Provider-reported settlement dates are known for {report.providerSettlementDates.knownOrders} recorded payments and unknown for {report.providerSettlementDates.unknownOrders}. {report.providerSettlementDates.settledDuringWindow} settled during these dates; {report.providerSettlementDates.settledOutsideWindow} outside them. These dates come from provider batches and are separate from when the store recorded a payment.</p>}
      <h4>Saved refund evidence for this cohort</h4>
      <Table><TableHeader><TableRow><TableHead>Provider state</TableHead><TableHead className={styles.number}>Transactions</TableHead><TableHead className={styles.number}>Known amount</TableHead><TableHead className={styles.number}>Amount needs review</TableHead></TableRow></TableHeader><TableBody>{(['settled','pending'] as const).map(state => <TableRow key={state}><TableCell>{state==='settled'?'Refund settled':'Refund pending settlement'}</TableCell><TableCell className={styles.number}>{report.refunds[state].transactions}</TableCell><TableCell className={styles.number}>{money(report.refunds[state].cents)}</TableCell><TableCell className={styles.number}>{report.refunds[state].missingAmounts}</TableCell></TableRow>)}</TableBody></Table>
      <p>Saved provider checks retain at most 10 attempts per order. {report.refunds.ordersAtHistoryLimit} orders reached that limit; {report.refunds.ordersWithoutCheck} have no usable check. Repeated transaction IDs are counted once, with settled evidence taking priority. {report.refunds.unidentifiedAttempts} attempts lack a usable transaction ID; {report.refunds.otherStatuses} have another refund state. Refunds are not inferred from an order label, and these checks are not a complete refund ledger.</p>
      <h4>Affiliate commission eligibility</h4>
      <Table><TableHeader><TableRow><TableHead>Current eligibility</TableHead><TableHead className={styles.number}>Orders</TableHead><TableHead className={styles.number}>Commission</TableHead></TableRow></TableHeader><TableBody>{(['eligible','held','excluded'] as const).map(state => <TableRow key={state}><TableCell>{state==='eligible'?'Eligible':state==='held'?'Held':'Excluded'}</TableCell><TableCell className={styles.number}>{report.commissions[state].orders}</TableCell><TableCell className={styles.number}>{money(report.commissions[state].cents)}</TableCell></TableRow>)}</TableBody></Table>
      <p>Uses the accepted terms saved on each order, recorded payment observations, holding periods and staff reviews. All attributed orders in this cohort are included. Eligibility is not a payout balance; recorded payouts are managed in Partners.</p>
    </>}
  </section>;
}
