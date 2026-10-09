import type { PromoAnalyticsReport } from './promo-analytics';

const columns = ['record_type', 'code', 'percent_off', 'active', 'environment', 'classification', 'orders_started', 'payment_recorded', 'gross_cents', 'promo_discount_cents', 'missing_payment_records', 'missing_amount_records', 'missing_discount_records', 'metadata_key', 'metadata_value'] as const;
type ExportRow = Partial<Record<typeof columns[number], string | number>>;
const iso = (value: number) => new Date(value).toISOString();

function cell(value: string | number | undefined) {
  const text = value === undefined ? '' : String(value);
  const safe = typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

/** Select aggregate fields explicitly; never serialize orders, customers or payment references. */
export function promoAnalyticsExport(report: PromoAnalyticsReport) {
  const rows: ExportRow[] = [];
  const metadata = (key: string, value: string | number) => rows.push({ record_type: 'metadata', classification: report.classification, metadata_key: key, metadata_value: value });
  metadata('format_version', 1);
  metadata('as_of_utc', iso(report.asOf));
  metadata('period_days', report.window.days);
  metadata('window_start_utc_inclusive', report.window.start === null ? 'All available order history' : iso(report.window.start));
  metadata('window_end_utc_exclusive', iso(report.window.end));
  metadata('time_zone', report.window.timeZone);
  metadata('includes_partial_today', String(report.window.includesPartialToday));
  metadata('currency', 'USD');
  metadata('classification', report.classification);
  metadata('environment_scope', 'All environments are exported separately. Live payments can include internal tests; customer-versus-test classification is unclassified.');
  metadata('measurement_scope', 'Orders with a saved promo code, grouped by order creation date and current payment evidence. Not cart applications, unique visitors, conversion rates or daily payment cohorts.');
  metadata('payment_evidence', 'Payment recorded requires a paid or fulfillment status plus complete payment and verification references. Missing-reference orders are excluded from recorded payment totals.');
  metadata('gross_scope', 'Recorded gross is USD cents on payment-recorded orders; it includes shipping and tax before refunds and is not net revenue. Missing or invalid gross amounts are excluded and counted as missing_amount_records.');
  metadata('discount_scope', 'Promo discount is USD cents on payment-recorded orders. Missing discount records are counted separately and must not be interpreted as zero discount.');
  metadata('code_scope', 'Active and historical inactive codes are included. Active percentages describe the current code setting, not each historical order. An empty percent_off means the percentage is not available; do not infer it from the code name.');
  for (const code of report.codes) for (const row of code.rows) rows.push({
    record_type: 'promo_orders', code: code.code, percent_off: code.percentOff ?? '', active: String(code.active),
    environment: row.environment, classification: report.classification, orders_started: row.orders,
    payment_recorded: row.paymentRecorded, gross_cents: row.grossCents, promo_discount_cents: row.discountCents,
    missing_payment_records: row.missingPaymentRecords, missing_amount_records: row.missingAmountRecords, missing_discount_records: row.missingDiscountRecords,
  });
  return {
    filename: 'biomod-promo-analytics-' + iso(report.asOf).replaceAll(/[-:.]/g, '') + '-v1.csv',
    csv: '\uFEFF' + [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n') + '\r\n',
  };
}
