import { diagnosticWindow } from './sales-diagnostics';
import type { ReportOptionsInput } from './report-window';
import { commissionEligibility, type CommissionEvidence } from './affiliate-commission-policy';
export type FinancialAmount = { cents: number; knownOrders: number; missingOrders: number };
type RefundTotal = { transactions: number; cents: number; missingAmounts: number; conflictingAmounts: number };
export type FinancialReport = {
  asOf: number; window: ReturnType<typeof diagnosticWindow>; liveOrders: number; recordedPaymentOrders: number; missingPaymentReferences: number;
  amounts: Record<'gross' | 'subtotal' | 'discount' | 'tax' | 'customerShipping' | 'carrierCost', FinancialAmount>;
  carrierCoverage: { labelsRecorded: number; withoutLabel: number };
  paymentDates: { knownOrders: number; unknownOrders: number; recordedDuringWindow: number; recordedOutsideWindow: number };
  refunds: { settled: RefundTotal; pending: RefundTotal; unidentifiedAttempts: number; otherStatuses: number; ordersWithoutCheck: number; ordersAtHistoryLimit: number };
  commissions: Record<'eligible' | 'held' | 'excluded', { orders: number; cents: number }>;
};
type MoneyRow = { id: string; created: number; status: string; total: number; payment_ref: string | null; notification_id: string | null; subtotal: unknown; discount: unknown; tax: unknown; shipping: unknown; shipment_id: unknown; carrier_cost: unknown; paid_at: unknown; recorded_at: number | null; attempts: string | null; checked_at: unknown };
const amount = (): FinancialAmount => ({ cents: 0, knownOrders: 0, missingOrders: 0 });
const validCents = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const collect = (total: FinancialAmount, n: unknown) => { if (validCents(n)) { total.cents += n; total.knownOrders++; } else total.missingOrders++; };
const paid = (r: MoneyRow) => ['paid','labeling','shipped','delivered'].includes(r.status);
const safeData = "CASE WHEN json_valid(o.data) THEN o.data ELSE '{}' END";
const live = `json_extract(${safeData},'$.environment') IN ('live','authorizenet:live') AND COALESCE(json_extract(${safeData},'$.internalTest'),0)!=1`;
const field = (path: string) => `json_extract(${safeData},'$.${path}')`;
const financialFields = `o.id,o.created,o.status,o.total,o.payment_ref,o.notification_id,${field('subtotal')} subtotal,${field('discount')} discount,${field('tax')} tax,${field('shipping')} shipping,${field('shipment.shipmentId')} shipment_id,${field('shipment.costCents')} carrier_cost,${field('paidAt')} paid_at,p.recorded_at,${field('paymentCheck.attempts')} attempts,${field('paymentCheck.at')} checked_at`;
/** All cohorts are scanned in bounded pages. No record identifiers or provider references leave this module. */
export async function financialReport(db: D1Database, days: string | null, now = Date.now(), options: ReportOptionsInput = {}): Promise<FinancialReport> {
  const window = diagnosticWindow(days, now, options);
  const result: FinancialReport = { asOf: now, window, liveOrders: 0, recordedPaymentOrders: 0, missingPaymentReferences: 0,
    amounts: { gross: amount(), subtotal: amount(), discount: amount(), tax: amount(), customerShipping: amount(), carrierCost: amount() },
    carrierCoverage: { labelsRecorded: 0, withoutLabel: 0 }, paymentDates: { knownOrders: 0, unknownOrders: 0, recordedDuringWindow: 0, recordedOutsideWindow: 0 },
    refunds: { settled: {transactions:0,cents:0,missingAmounts:0,conflictingAmounts:0}, pending: {transactions:0,cents:0,missingAmounts:0,conflictingAmounts:0}, unidentifiedAttempts:0,otherStatuses:0,ordersWithoutCheck:0,ordersAtHistoryLimit:0 },
    commissions: { eligible: {orders:0,cents:0}, held: {orders:0,cents:0}, excluded: {orders:0,cents:0} } };
  const refunds = new Map<string, { settled?: Set<number>; pending?: Set<number> }>();
  let cursor: { created: number; id: string } | null = null;
  do {
    const rows: MoneyRow[] = (await db.prepare(`SELECT ${financialFields} FROM orders o LEFT JOIN order_payment_observations p ON p.order_id=o.id WHERE o.created>=? AND o.created<? AND ${live}${cursor?' AND (o.created>? OR (o.created=? AND o.id>?))':''} ORDER BY o.created,o.id LIMIT 500`).bind(window.start,window.end,...(cursor?[cursor.created,cursor.created,cursor.id]:[])).all<MoneyRow>()).results;
    for (const row of rows) {
      result.liveOrders++;
      if (paid(row)) {
        if (!row.payment_ref?.trim() || !row.notification_id?.trim()) result.missingPaymentReferences++;
        else {
          result.recordedPaymentOrders++;
          collect(result.amounts.gross,row.total); collect(result.amounts.subtotal,row.subtotal); collect(result.amounts.discount,row.discount); collect(result.amounts.tax,row.tax); collect(result.amounts.customerShipping,row.shipping);
          // paidAt is the existing explicit reconciliation stamp. Never substitute mutable updated or checkout created.
          const stamps=[row.recorded_at,row.paid_at].filter((v):v is number=>Number.isSafeInteger(v)&&Number(v)>=row.created&&Number(v)<=now);
          if (!stamps.length) result.paymentDates.unknownOrders++;
          else { const at=Math.min(...stamps);result.paymentDates.knownOrders++;if(at>=window.start&&at<window.end)result.paymentDates.recordedDuringWindow++;else result.paymentDates.recordedOutsideWindow++; }
        }
      }
      if (typeof row.shipment_id==='string' && row.shipment_id) { result.carrierCoverage.labelsRecorded++;collect(result.amounts.carrierCost,row.carrier_cost); }
      else result.carrierCoverage.withoutLabel++;
      let attempts: unknown=null;try{attempts=typeof row.attempts==='string'?JSON.parse(row.attempts):null;}catch{/* missing evidence remains explicit */}
      if(!Array.isArray(attempts)||!Number.isSafeInteger(row.checked_at)){result.refunds.ordersWithoutCheck++;continue;}
      if(attempts.length>=10)result.refunds.ordersAtHistoryLimit++;
      for(const attempt of attempts){
        if(!attempt||typeof attempt!=='object'||attempt.kind!=='refunded')continue;
        const state=attempt.status==='refundSettledSuccessfully'?'settled':attempt.status==='refundPendingSettlement'?'pending':null;
        if(!state){result.refunds.otherStatuses++;continue;}
        if(typeof attempt.transId!=='string'||!/^\d{1,20}$/.test(attempt.transId)){result.refunds.unidentifiedAttempts++;continue;}
        const existing=refunds.get(attempt.transId)||{};
        const amounts=existing[state] ||= new Set<number>();
        if(validCents(attempt.amountCents))amounts.add(attempt.amountCents);
        refunds.set(attempt.transId,existing);
      }
    }
    const last=rows.at(-1);cursor=rows.length===500&&last?{created:last.created,id:last.id}:null;
  } while(cursor);
  for(const refund of refunds.values()){
    const state=refund.settled?'settled':'pending',amounts=refund[state]!;
    const bucket=result.refunds[state];bucket.transactions++;
    if(amounts.size===1)bucket.cents += [...amounts][0];
    else {bucket.missingAmounts++;if(amounts.size>1)bucket.conflictingAmounts++;}
  }
  // Same policy as the partner earnings screen, over every attributed order in this cohort, with no 1,000-row ceiling.
  let after = '';
  while(true){
    const rows=(await db.prepare(`SELECT t.order_id,o.status,o.updated,o.payment_ref,o.notification_id,p.recorded_at,t.hold_days,t.basis_cents,t.commission_bps,r.state review_state,r.net_cents FROM affiliate_order_terms t JOIN orders o ON o.id=t.order_id LEFT JOIN affiliate_payment_observations p ON p.order_id=t.order_id LEFT JOIN affiliate_commission_reviews r ON r.order_id=t.order_id WHERE o.created>=? AND o.created<? AND ${live} AND t.order_id>? ORDER BY t.order_id LIMIT 500`).bind(window.start,window.end,after).all<CommissionEvidence & {order_id:string}>()).results;
    for(const row of rows){const c=commissionEligibility(row,now);result.commissions[c.state].orders++;result.commissions[c.state].cents+=c.commissionCents;}
    if(rows.length<500)break;after=rows[rows.length-1].order_id;
  }
  return result;
}
