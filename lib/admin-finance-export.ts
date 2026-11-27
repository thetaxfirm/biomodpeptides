import type { FinancialReport } from './admin-finance';
/** Aggregate-only export. A missing amount is a separate count, never silently treated as evidence of zero. */
export function financialCsv(report: FinancialReport) {
  const start = new Date(report.window.start).toISOString().slice(0,10), end = new Date(report.window.end-1).toISOString().slice(0,10);
  const rows: (string | number)[][] = [['section','metric','records','known_amount_cents','missing_amount_records','basis'],
    ['period',start+' through '+end,'','','','Complete UTC days; order-start cohort; current evidence'],
    ['coverage','live_orders',report.liveOrders,'','','Excludes sandbox and marked internal tests'],
    ['coverage','recorded_payments',report.recordedPaymentOrders,'','','Current paid or fulfillment status with payment references'],
    ['coverage','missing_payment_references',report.missingPaymentReferences,'','','Excluded from recorded-payment amounts']];
  for (const [key,value] of Object.entries(report.amounts)) rows.push(['amount',key,value.knownOrders,value.cents,value.missingOrders,key==='carrierCost'?'Purchased labels across cohort':'Recorded-payment orders']);
  for (const key of ['settled','pending'] as const) {const r=report.refunds[key];rows.push(['refund',key,r.transactions,r.cents,r.missingAmounts,'Saved provider attempts, transaction IDs deduplicated; not complete ledger']);}
  for (const key of ['eligible','held','excluded'] as const) {const r=report.commissions[key];rows.push(['commission',key,r.orders,r.cents,'','Current eligibility for cohort; not payout balance']);}
  for (const [key,value] of Object.entries(report.paymentDates)) rows.push(['payment_date_coverage',key,value,'','','Explicit recording dates only; missing historical dates remain unknown']);
  for (const key of ['unidentifiedAttempts','otherStatuses','ordersWithoutCheck','ordersAtHistoryLimit'] as const) rows.push(['refund_coverage',key,report.refunds[key],'','','Checks retain at most 10 attempts per order']);
  const cell=(v:string|number)=>'"'+String(v).replaceAll('"','""')+'"';
  return {filename:`financial-records-${start}-to-${end}.csv`,csv:rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'};
}
