/** Read-only aggregates. Never return raw order/request data or customer identifiers. */
export type DiagnosticEnvironment = 'live' | 'sandbox' | 'unknown';
export type DiagnosticOrder = {
  dayUtc: string; environment: DiagnosticEnvironment; status: string;
  orders: number; paymentRecorded: number; grossCents: number; missingPaymentRecords: number;
};
export type DiagnosticRequest = { dayUtc: string; kind: 'quote' | 'contact' | 'stock' | 'affiliate'; records: number };
export type DiagnosticPending = { environment: DiagnosticEnvironment; status: string; records: number; oldestCreated: number };
export type SalesDiagnosticsReport = {
  asOf: number; window: { days: 7 | 30; start: number; end: number; timeZone: 'UTC' };
  classification: 'unclassified';
  orders: DiagnosticOrder[]; requests: DiagnosticRequest[]; unresolvedOrders: DiagnosticPending[];
  cartConflicts: { records: number; oldestCreated: number | null };
};
type Dependencies = {
  requireAdmin: () => Promise<unknown>;
  all: <T>(sql: string, ...values: (string | number | null)[]) => Promise<T[]>;
};
const dayMs = 86400000;
export function diagnosticWindow(value: string | null, now: number) {
  if (value !== null && value !== '7' && value !== '30') throw new Error('Choose a 7-day or 30-day reporting period.');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Reporting time is unavailable.');
  const days = value === '30' ? 30 : 7;
  const end = Math.floor(now / dayMs) * dayMs;
  return { days, start: end - days * dayMs, end, timeZone: 'UTC' } as const;
}
// Legacy malformed or unclassified JSON remains in the unknown bucket.
const environment = `CASE WHEN json_valid(data) THEN CASE json_extract(data, '$.environment')
  WHEN 'live' THEN 'live' WHEN 'sandbox' THEN 'sandbox' ELSE 'unknown' END ELSE 'unknown' END`;
const paidStatus = "status IN ('paid','labeling','shipped','delivered')";
const proof = "NULLIF(TRIM(payment_ref), '') IS NOT NULL AND NULLIF(TRIM(notification_id), '') IS NOT NULL";
export const diagnosticSql = {
  orders: `WITH cohort AS (
    SELECT date(created / 1000, 'unixepoch') AS dayUtc, ${environment} AS environment,
      CASE WHEN status IN ('creating','awaiting_payment','pending','review','paid','labeling','shipped','delivered','cancelled','failed') THEN status ELSE 'unknown' END AS status,
      total,
      CASE WHEN ${paidStatus} AND ${proof} THEN 1 ELSE 0 END AS paymentRecorded,
      CASE WHEN ${paidStatus} AND NOT (${proof}) THEN 1 ELSE 0 END AS missingPaymentRecords
    FROM orders WHERE created >= ? AND created < ?
  ) SELECT dayUtc, environment, status, COUNT(*) AS orders,
      SUM(paymentRecorded) AS paymentRecorded,
      SUM(CASE WHEN paymentRecorded = 1 THEN total ELSE 0 END) AS grossCents,
      SUM(missingPaymentRecords) AS missingPaymentRecords
    FROM cohort GROUP BY dayUtc, environment, status ORDER BY dayUtc DESC, environment, status`,
  requests: `SELECT date(created / 1000, 'unixepoch') AS dayUtc, kind, COUNT(*) AS records
    FROM requests WHERE created >= ? AND created < ? AND kind IN ('quote','contact','stock','affiliate')
    GROUP BY dayUtc, kind ORDER BY dayUtc DESC, kind`,
  unresolvedOrders: `SELECT ${environment} AS environment, status, COUNT(*) AS records, MIN(created) AS oldestCreated
    FROM orders WHERE status IN ('creating','awaiting_payment','pending','review')
    GROUP BY environment, status ORDER BY environment, status`,
  cartConflicts: `SELECT COUNT(*) AS records, MIN(created) AS oldestCreated
    FROM requests WHERE kind = 'cart_import' AND status = 'cart_conflict'`,
};
export async function salesDiagnostics(deps: Dependencies, days: string | null, now = Date.now()): Promise<SalesDiagnosticsReport> {
  // Authorization precedes both validation and every database read.
  await deps.requireAdmin();
  const window = diagnosticWindow(days, now);
  try {
    const [orders, requests, unresolvedOrders, conflicts] = await Promise.all([
      deps.all<DiagnosticOrder>(diagnosticSql.orders, window.start, window.end),
      deps.all<DiagnosticRequest>(diagnosticSql.requests, window.start, window.end),
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
