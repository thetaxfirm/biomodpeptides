/** Read-only aggregates. Never return raw order/request data or customer identifiers. */
import { calendarReportWindow, reportDayBoundaries, ReportWindowError, type ReportOptionsInput, type ReportWindow } from './report-window';
export type DiagnosticEnvironment = 'live' | 'sandbox' | 'unknown';
export type DiagnosticOrder = {
  dayUtc?: string; day?: string; environment: DiagnosticEnvironment; status: string;
  orders: number; paymentRecorded: number; grossCents: number; missingPaymentRecords: number;
};
export type DiagnosticRequest = { dayUtc?: string; day?: string; kind: 'quote' | 'contact' | 'stock' | 'affiliate'; records: number };
export type DiagnosticPending = { environment: DiagnosticEnvironment; status: string; records: number; oldestCreated: number };
export type SalesDiagnosticsReport = {
  asOf: number; window: ReportWindow;
  classification: 'unclassified';
  orders: DiagnosticOrder[]; requests: DiagnosticRequest[]; unresolvedOrders: DiagnosticPending[];
  cartConflicts: { records: number; oldestCreated: number | null };
};
type Dependencies = {
  requireAdmin: () => Promise<unknown>;
  all: <T>(sql: string, ...values: (string | number | null)[]) => Promise<T[]>;
};
export function diagnosticWindow(value: string | null, now: number, options: ReportOptionsInput = {}): ReportWindow {
  if (value !== null && value !== '7' && value !== '30') throw new ReportWindowError('Choose a 7-day or 30-day reporting period.');
  return calendarReportWindow(value, now, options, {defaultDays:7,allowedDays:[7,30]});
}
// Match the saved paymentEnvironment contract: Chase uses bare modes; Authorize.net prefixes its provider.
// Legacy malformed or unclassified JSON remains in the unknown bucket.
const environment = `CASE WHEN json_valid(data) THEN CASE json_extract(data, '$.environment')
  WHEN 'live' THEN 'live' WHEN 'authorizenet:live' THEN 'live'
  WHEN 'sandbox' THEN 'sandbox' WHEN 'authorizenet:sandbox' THEN 'sandbox'
  ELSE 'unknown' END ELSE 'unknown' END`;
const paidStatus = "status IN ('paid','labeling','shipped','delivered')";
const proof = "NULLIF(TRIM(payment_ref), '') IS NOT NULL AND NULLIF(TRIM(notification_id), '') IS NOT NULL";
function dailyQueries(local = false) {
  const calendar = local ? "report_days AS (SELECT json_extract(value,'$.date') date,json_extract(value,'$.start') start,json_extract(value,'$.end') end FROM json_each(?))," : '';
  const day = local ? 'report_days.date AS day' : "date(created / 1000, 'unixepoch') AS dayUtc";
  const dayName = local ? 'day' : 'dayUtc';
  const join = local ? ' JOIN report_days ON created>=report_days.start AND created<report_days.end' : '';
  return {
  orders: `WITH ${calendar} cohort AS (
    SELECT ${day}, ${environment} AS environment,
      CASE WHEN status IN ('creating','awaiting_payment','pending','review','paid','labeling','shipped','delivered','cancelled','failed') THEN status ELSE 'unknown' END AS status,
      total,
      CASE WHEN ${paidStatus} AND ${proof} THEN 1 ELSE 0 END AS paymentRecorded,
      CASE WHEN ${paidStatus} AND NOT (${proof}) THEN 1 ELSE 0 END AS missingPaymentRecords
    FROM orders${join} WHERE created >= ? AND created < ? AND COALESCE(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.internalTest'),0)!=1
  ) SELECT ${dayName}, environment, status, COUNT(*) AS orders,
      SUM(paymentRecorded) AS paymentRecorded,
      SUM(CASE WHEN paymentRecorded = 1 THEN total ELSE 0 END) AS grossCents,
      SUM(missingPaymentRecords) AS missingPaymentRecords
    FROM cohort GROUP BY ${dayName}, environment, status ORDER BY ${dayName} DESC, environment, status`,
  requests: `${local ? 'WITH ' + calendar.slice(0,-1) : ''} SELECT ${day}, kind, COUNT(*) AS records
    FROM requests${join} WHERE created >= ? AND created < ? AND kind IN ('quote','contact','stock','affiliate')
    GROUP BY ${dayName}, kind ORDER BY ${dayName} DESC, kind`,
  };
}
export const diagnosticSql = {
  ...dailyQueries(),
  unresolvedOrders: `SELECT ${environment} AS environment, status, COUNT(*) AS records, MIN(created) AS oldestCreated
    FROM orders WHERE status IN ('creating','awaiting_payment','pending','review') AND COALESCE(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.internalTest'),0)!=1
    GROUP BY environment, status ORDER BY environment, status`,
  cartConflicts: `SELECT COUNT(*) AS records, MIN(created) AS oldestCreated
    FROM requests WHERE kind = 'cart_import' AND status = 'cart_conflict'`,
};
export async function salesDiagnostics(deps: Dependencies, days: string | null, now = Date.now(), options: ReportOptionsInput = {}): Promise<SalesDiagnosticsReport> {
  // Authorization precedes both validation and every database read.
  await deps.requireAdmin();
  const window = diagnosticWindow(days, now, options);
  const local = window.timeZone !== 'UTC', queries = dailyQueries(local);
  // One JSON binding carries bounded calendar intervals, below D1's parameter limit even for 366 dates.
  const bindings = [...(local ? [JSON.stringify(reportDayBoundaries(window))] : []), window.start, window.end];
  try {
    const [orders, requests, unresolvedOrders, conflicts] = await Promise.all([
      deps.all<DiagnosticOrder>(queries.orders, ...bindings),
      deps.all<DiagnosticRequest>(queries.requests, ...bindings),
      deps.all<DiagnosticPending>(diagnosticSql.unresolvedOrders),
      deps.all<SalesDiagnosticsReport['cartConflicts']>(diagnosticSql.cartConflicts),
    ]);
    return { asOf: now, window, classification: 'unclassified', orders, requests, unresolvedOrders,
      cartConflicts: conflicts[0] || { records: 0, oldestCreated: null } };
  } catch {
    // Do not expose SQL errors or database details through this reporting endpoint.
    throw new Error('Sales diagnostics could not load. Please retry.');
  }
}
