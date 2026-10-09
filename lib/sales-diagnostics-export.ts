import type { SalesDiagnosticsReport } from './sales-diagnostics';

const columns = ['record_type', 'day_utc', 'environment', 'status_or_kind', 'classification', 'orders', 'payment_recorded', 'gross_cents', 'missing_payment_records', 'records', 'oldest_created_utc', 'metadata_key', 'metadata_value'] as const;
type ExportRow = Partial<Record<typeof columns[number], string | number>>;
const iso = (value: number) => new Date(value).toISOString();

/** Quote every field and neutralize spreadsheet formulas, including whitespace-prefixed formulas. */
function cell(value: string | number | undefined) {
  const text = value === undefined ? '' : String(value);
  const safe = typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

/** Export only named aggregate fields from the already-authorized report. Never serialize raw records. */
export function salesDiagnosticsExport(report: SalesDiagnosticsReport) {
  const rows: ExportRow[] = [];
  const metadata = (key: string, value: string | number) => rows.push({ record_type: 'metadata', classification: report.classification, metadata_key: key, metadata_value: value });
  metadata('format_version', 1);
  metadata('as_of_utc', iso(report.asOf));
  metadata('period_days', report.window.days);
  metadata('window_start_utc_inclusive', iso(report.window.start));
  metadata('window_end_utc_exclusive', iso(report.window.end));
  metadata('time_zone', report.window.timeZone);
  metadata('currency', 'USD');
  metadata('classification', report.classification);
  metadata('measurement_scope', 'Existing order and request records only. No visitor, people, traffic-source or conversion-rate measurements.');
  metadata('window_scope', 'Order and request counts use complete UTC days; the current partial day is excluded.');
  metadata('order_cohort', 'Orders are grouped by creation date, with payment status as of this export. Payment completion dates are not recorded separately; these are not daily sales.');
  metadata('customer_test_classification', 'All orders are unclassified as customer purchases or internal tests. A live payment can still be an internal test.');
  metadata('payment_evidence', 'Payment recorded requires a paid or fulfillment status plus both payment and verification references. Missing-reference orders are excluded from recorded payment totals.');
  metadata('gross_scope', 'Gross is recorded in USD cents, includes tax and shipping, is not net revenue and does not account for refunds.');
  metadata('request_scope', 'Repeated delivery calculations can issue multiple quotes for one account. Failed quotes are not recorded. Request counts cannot establish quote-to-purchase conversion or distinguish internal tests.');
  metadata('unresolved_scope', 'Unresolved orders and cart conflicts include all dates, including today. They are outstanding records, not confirmed abandoned checkouts or active shoppers.');
  metadata('empty_sections', 'No rows in an orders, requests or unresolved_orders section means no matching records in the report, not unavailable visitor data.');
  for (const row of report.orders) rows.push({ record_type: 'orders', day_utc: row.dayUtc, environment: row.environment, status_or_kind: row.status, classification: report.classification, orders: row.orders, payment_recorded: row.paymentRecorded, gross_cents: row.grossCents, missing_payment_records: row.missingPaymentRecords });
  for (const row of report.requests) rows.push({ record_type: 'requests', day_utc: row.dayUtc, status_or_kind: row.kind, classification: report.classification, records: row.records });
  for (const row of report.unresolvedOrders) rows.push({ record_type: 'unresolved_orders', environment: row.environment, status_or_kind: row.status, classification: report.classification, records: row.records, oldest_created_utc: iso(row.oldestCreated) });
  rows.push({ record_type: 'cart_conflicts', classification: report.classification, records: report.cartConflicts.records, oldest_created_utc: report.cartConflicts.oldestCreated === null ? '' : iso(report.cartConflicts.oldestCreated) });
  return {
    filename: 'biomod-sales-diagnostics-' + iso(report.asOf).replaceAll(/[-:.]/g, '') + '-v1.csv',
    csv: '\uFEFF' + [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n') + '\r\n',
  };
}
