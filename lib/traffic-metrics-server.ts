import { calendarMetricsReport } from './traffic-calendar-report';
import {
  TRAFFIC_ORIGIN, TRAFFIC_DAILY_CAP,
  TRAFFIC_RETENTION_DAYS, TRAFFIC_MAX_BODY_BYTES, TRAFFIC_DAY_MS,
  trafficConfiguration, trafficUtcDay, validTrafficEvent,
  type TrafficEvent, type TrafficFlags, type TrafficCleanupHealth,
} from './traffic-metrics';

import { SHOPPING_DAILY_CAP, shoppingConfiguration, validShoppingEvent, type ShoppingEvent } from './shopping-metrics';

type Dependencies = { env: () => TrafficFlags; database: () => D1Database; now?: () => number };
type ReportDependencies = Dependencies & { requireAdmin: () => Promise<unknown> };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (status: number, error?: string) => new Response(error ? JSON.stringify({ error }) : null, {
  status, headers: { ...headers, ...(error ? { 'Content-Type': 'application/json' } : {}) },
});
const healthSql = `INSERT INTO traffic_metrics_health(id,last_attempt,last_success,last_failure,last_status)
  VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
  last_attempt=MAX(traffic_metrics_health.last_attempt,excluded.last_attempt),
  last_success=CASE WHEN excluded.last_success IS NULL THEN traffic_metrics_health.last_success
    ELSE MAX(COALESCE(traffic_metrics_health.last_success,0),excluded.last_success) END,
  last_failure=CASE WHEN excluded.last_failure IS NULL THEN traffic_metrics_health.last_failure
    ELSE MAX(COALESCE(traffic_metrics_health.last_failure,0),excluded.last_failure) END,
  last_status=CASE WHEN excluded.last_attempt>=traffic_metrics_health.last_attempt THEN excluded.last_status ELSE traffic_metrics_health.last_status END`;
export const trafficSql = {
  record: `INSERT INTO traffic_daily(day,page_group,source_group,event_count)
    SELECT ?,?,?,1 WHERE (SELECT COALESCE(SUM(event_count),0) FROM traffic_daily WHERE day=?) < ?
    ON CONFLICT(day,page_group,source_group) DO UPDATE SET event_count=traffic_daily.event_count+1
    RETURNING event_count`,
  cleanup: 'DELETE FROM traffic_daily WHERE day < ?',
};
export const shoppingSql = {
  record: `INSERT INTO shopping_daily(day,stage,event_count)
    SELECT ?,?,1 WHERE (SELECT COALESCE(SUM(event_count),0) FROM shopping_daily WHERE day=?) < ?
    ON CONFLICT(day,stage) DO UPDATE SET event_count=shopping_daily.event_count+1
    RETURNING event_count`,
  cleanup: 'DELETE FROM shopping_daily WHERE day < ?',
};
const coverageSql = `INSERT INTO metrics_time_coverage(kind,started_at) SELECT ?,? WHERE changes()>0
  ON CONFLICT(kind) DO UPDATE SET started_at=MIN(metrics_time_coverage.started_at,excluded.started_at)`;
async function cleanupHealth(db: D1Database): Promise<TrafficCleanupHealth> {
  const row = await db.prepare('SELECT last_attempt,last_success,last_failure,last_status FROM traffic_metrics_health WHERE id=1')
    .first<{ last_attempt: number; last_success: number | null; last_failure: number | null; last_status: 'ok' | 'failed' }>();
  if (!row) return { lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, status: 'never', retentionDays: TRAFFIC_RETENTION_DAYS };
  const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();
  return { lastAttemptAt: iso(row.last_attempt), lastSuccessAt: iso(row.last_success), lastFailureAt: iso(row.last_failure), status: row.last_status, retentionDays: TRAFFIC_RETENTION_DAYS };
}
/** Called by ingestion, protected reporting, and the root worker's scheduled event.
 * D1 batches are transactional. Failure metadata is best effort if storage itself is down. */
export async function cleanupTraffic(db: D1Database, now = Date.now()): Promise<TrafficCleanupHealth> {
  const cutoff = trafficUtcDay(Math.max(0, Math.floor(now / TRAFFIC_DAY_MS) * TRAFFIC_DAY_MS - (TRAFFIC_RETENTION_DAYS - 1) * TRAFFIC_DAY_MS));
  try {
    await db.batch([
      db.prepare(trafficSql.cleanup).bind(cutoff),
      db.prepare(shoppingSql.cleanup).bind(cutoff),
      db.prepare('DELETE FROM traffic_minute WHERE bucket < ?').bind(Date.parse(cutoff + 'T00:00:00Z')),
      db.prepare('DELETE FROM shopping_minute WHERE bucket < ?').bind(Date.parse(cutoff + 'T00:00:00Z')),
      db.prepare(healthSql).bind(now, now, null, 'ok'),
    ]);
    return await cleanupHealth(db);
  } catch {
    try { await db.prepare(healthSql).bind(now, null, now, 'failed').run(); } catch { /* Never log requests or exception details. */ }
    throw new Error('Traffic storage is unavailable.');
  }
}
export async function recordTraffic(db: D1Database, event: TrafficEvent, now = Date.now()): Promise<boolean> {
  if (!validTrafficEvent(event)) throw new Error('Invalid traffic event.');
  const day = trafficUtcDay(now);
  await cleanupTraffic(db, now);
  // D1 executes the batch transactionally. changes() links the next write to acceptance
  // of the preceding increment, so a capped event cannot enter the minute aggregates.
  const result = await db.batch([
    db.prepare(trafficSql.record).bind(day, event.pageGroup, event.sourceGroup, day, TRAFFIC_DAILY_CAP),
    db.prepare(`INSERT INTO traffic_minute(bucket,page_group,source_group,event_count)
      SELECT ?,?,?,1 WHERE changes()>0 ON CONFLICT(bucket,page_group,source_group)
      DO UPDATE SET event_count=traffic_minute.event_count+1`).bind(Math.floor(now / 60000) * 60000, event.pageGroup, event.sourceGroup),
    db.prepare(coverageSql).bind('traffic', now),
  ]);
  return result[0].meta.changes > 0;
}
export async function recordShopping(db: D1Database, event: ShoppingEvent, now = Date.now()): Promise<boolean> {
  if (!validShoppingEvent(event)) throw new Error('Invalid shopping event.');
  const day = trafficUtcDay(now);
  await cleanupTraffic(db, now);
  const result = await db.batch([
    db.prepare(shoppingSql.record).bind(day, event.event, day, SHOPPING_DAILY_CAP),
    db.prepare(`INSERT INTO shopping_minute(bucket,stage,event_count)
      SELECT ?,?,1 WHERE changes()>0 ON CONFLICT(bucket,stage)
      DO UPDATE SET event_count=shopping_minute.event_count+1`).bind(Math.floor(now / 60000) * 60000, event.event),
    db.prepare(coverageSql).bind('shopping', now),
  ]);
  return result[0].meta.changes > 0;
}
async function smallJson(req: Request): Promise<unknown> {
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TRAFFIC_MAX_BODY_BYTES)) throw new Error('Body limit');
  if (!req.body) throw new Error('Missing body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > TRAFFIC_MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Body limit'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let position = 0;
  for (const chunk of chunks) { body.set(chunk, position); position += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}
export async function handleTrafficPost(req: Request, deps: Dependencies): Promise<Response> {
  let url: URL;
  try { url = new URL(req.url); } catch { return response(400, 'Invalid request.'); }
  if (req.method !== 'POST' || url.origin !== TRAFFIC_ORIGIN || req.headers.get('origin') !== TRAFFIC_ORIGIN
    || req.headers.get('sec-fetch-site') !== 'same-origin') return response(403, 'Request not allowed.');
  if (url.search || url.hash || url.pathname !== '/api/metrics'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type') || '')
    || (req.headers.has('content-encoding') && req.headers.get('content-encoding') !== 'identity')) return response(400, 'Invalid request.');
  if (req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1') return response(204);
  let event: unknown;
  try { event = await smallJson(req); } catch { return response(400, 'Invalid event.'); }
  if (!validTrafficEvent(event) && !validShoppingEvent(event)) return response(400, 'Invalid event.');
  const now = deps.now?.() ?? Date.now();
  const configuration = event.event === 'page_view' ? trafficConfiguration(deps.env(), now) : shoppingConfiguration(deps.env(), now);
  if (!configuration.enabled) return response(204);
  try {
    if (event.event === 'page_view') await recordTraffic(deps.database(), event, now);
    else await recordShopping(deps.database(), event, now);
    return response(204);
  }
  catch { return response(503, 'Traffic recording is temporarily unavailable.'); }
}
export const trafficReport = (req: Request, deps: ReportDependencies) => calendarMetricsReport(req, deps, 'traffic', cleanupTraffic);
export const shoppingReport = (req: Request, deps: ReportDependencies) => calendarMetricsReport(req, deps, 'shopping', cleanupTraffic);
