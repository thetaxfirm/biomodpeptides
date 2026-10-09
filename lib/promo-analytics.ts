import { activePromotions } from './promotions';

/** Admin-only, order-created cohorts. Stored payment records are not proof of
 * customer sales; internal tests remain unclassified and amounts are not net revenue. */
export type PromoEnvironment = 'live' | 'sandbox' | 'unknown';
export type PromoAnalyticsRow = {
  environment: PromoEnvironment; orders: number; paymentRecorded: number;
  grossCents: number; discountCents: number; missingPaymentRecords: number;
  missingDiscountRecords: number; missingAmountRecords: number;
};
export type PromoAnalyticsReport = {
  asOf: number;
  window: { days: 7 | 30 | 90 | 'all'; start: number; end: number; timeZone: 'UTC'; includesPartialToday: true };
  classification: 'unclassified';
  codes: { code: string; percentOff: number | null; active: boolean; rows: PromoAnalyticsRow[] }[];
};
type Dependencies = {
  requireAdmin: () => Promise<unknown>;
  all: <T>(sql: string, ...values: (string | number | null)[]) => Promise<T[]>;
};
const environments: PromoEnvironment[] = ['live', 'sandbox', 'unknown'];
const historicalCodes = ['BIOMOD10', 'BIOMOD20'];
const unknownCode = 'Unrecognized code';
const numericFields = ['orders', 'paymentRecorded', 'grossCents', 'discountCents', 'missingPaymentRecords', 'missingDiscountRecords', 'missingAmountRecords'] as const;
const dayMs = 86400000;
export function promoWindow(value: string | null, now: number): PromoAnalyticsReport['window'] {
  if (value !== null && !['7', '30', '90', 'all'].includes(value)) throw new Error('Choose 7, 30, or 90 days, or all time.');
  if (!Number.isSafeInteger(now) || now < 0 || now >= Number.MAX_SAFE_INTEGER) throw new Error('Reporting time is unavailable.');
  const days = value === 'all' ? 'all' : value === '7' ? 7 : value === '90' ? 90 : 30;
  const start = days === 'all' ? 0 : Math.max(0, Math.floor(now / dayMs) * dayMs - (days - 1) * dayMs);
  return { days, start, end: now + 1, timeZone: 'UTC', includesPartialToday: true };
}
const emptyRow = (environment: PromoEnvironment): PromoAnalyticsRow => ({ environment, orders: 0, paymentRecorded: 0, grossCents: 0, discountCents: 0, missingPaymentRecords: 0, missingDiscountRecords: 0, missingAmountRecords: 0 });
function aggregateSql(knownCodes: string[]) {
  // CASE gives every JSON operation valid input, including legacy corrupt rows.
  // Only allowlisted labels leave SQL; arbitrary saved strings never reach a report.
  return `WITH source AS (
    SELECT status, total, payment_ref, notification_id,
      CASE WHEN json_valid(data) THEN data ELSE '{}' END AS safeData
    FROM orders WHERE created >= ? AND created < ?
  ), attributed AS (
    SELECT status, total, payment_ref, notification_id,
      CASE json_extract(safeData, '$.environment')
        WHEN 'live' THEN 'live' WHEN 'authorizenet:live' THEN 'live'
        WHEN 'sandbox' THEN 'sandbox' WHEN 'authorizenet:sandbox' THEN 'sandbox'
        ELSE 'unknown' END AS environment,
      CASE WHEN json_type(safeData, '$.promo.code') = 'text'
        THEN UPPER(TRIM(json_extract(safeData, '$.promo.code'))) ELSE NULL END AS savedCode,
      json_extract(safeData, '$.promo.savings') AS savings,
      CASE WHEN json_type(safeData, '$.promo.savings') = 'integer'
        AND json_extract(safeData, '$.promo.savings') BETWEEN 0 AND 9007199254740991 THEN 1 ELSE 0 END AS validSavings
    FROM source WHERE json_type(safeData, '$.promo') IS NOT NULL AND json_type(safeData, '$.promo') != 'null'
  ), cohort AS (
    SELECT CASE WHEN savedCode IN (${knownCodes.map(() => '?').join(',')}) THEN savedCode ELSE '${unknownCode}' END AS code,
      environment, total, savings, validSavings,
      CASE WHEN typeof(total) = 'integer' AND total BETWEEN 0 AND 9007199254740991 THEN 1 ELSE 0 END AS validTotal,
      CASE WHEN status IN ('paid','labeling','shipped','delivered')
        AND NULLIF(TRIM(payment_ref), '') IS NOT NULL AND NULLIF(TRIM(notification_id), '') IS NOT NULL THEN 1 ELSE 0 END AS paymentRecorded,
      CASE WHEN status IN ('paid','labeling','shipped','delivered')
        AND NOT (NULLIF(TRIM(payment_ref), '') IS NOT NULL AND NULLIF(TRIM(notification_id), '') IS NOT NULL) THEN 1 ELSE 0 END AS missingPaymentRecords
    FROM attributed
  ) SELECT code, environment, COUNT(*) AS orders, SUM(paymentRecorded) AS paymentRecorded,
      SUM(CASE WHEN paymentRecorded = 1 AND validTotal = 1 THEN total ELSE 0 END) AS grossCents,
      SUM(CASE WHEN paymentRecorded = 1 AND validSavings = 1 THEN savings ELSE 0 END) AS discountCents,
      SUM(missingPaymentRecords) AS missingPaymentRecords,
      SUM(CASE WHEN paymentRecorded = 1 AND validSavings = 0 THEN 1 ELSE 0 END) AS missingDiscountRecords,
      SUM(CASE WHEN paymentRecorded = 1 AND validTotal = 0 THEN 1 ELSE 0 END) AS missingAmountRecords
    FROM cohort GROUP BY code, environment ORDER BY code, environment`;
}
export async function promoAnalytics(deps: Dependencies, days: string | null, now = Date.now()): Promise<PromoAnalyticsReport> {
  await deps.requireAdmin(); // Authorization precedes validation and every database read.
  const window = promoWindow(days, now);
  try {
    const active = activePromotions();
    const knownCodes = [...new Set([...active.map(p => p.code), ...historicalCodes])];
    const aggregates = await deps.all<PromoAnalyticsRow & { code: string }>(aggregateSql(knownCodes), window.start, window.end, ...knownCodes);
    const codes = new Map<string, PromoAnalyticsReport['codes'][number]>(active.map(p => [p.code, { ...p, active: true, rows: environments.map(emptyRow) }]));
    for (const aggregate of aggregates) {
      if ((!knownCodes.includes(aggregate.code) && aggregate.code !== unknownCode) || !environments.includes(aggregate.environment)) throw new Error('Invalid aggregate category');
      const row = emptyRow(aggregate.environment);
      for (const key of numericFields) {
        const value = aggregate[key];
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid aggregate amount');
        row[key] = value;
      }
      if (!codes.has(aggregate.code)) codes.set(aggregate.code, { code: aggregate.code, percentOff: null, active: false, rows: environments.map(emptyRow) });
      codes.get(aggregate.code)!.rows[environments.indexOf(aggregate.environment)] = row;
    }
    return { asOf: now, window, classification: 'unclassified', codes: [...codes.values()] };
  } catch {
    // Database errors must not leak schema, references, or data through the API.
    throw new Error('Promo analytics could not load. Please retry.');
  }
}
