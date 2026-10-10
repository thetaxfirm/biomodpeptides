import {
  TRAFFIC_ORIGIN, TRAFFIC_PAGE_GROUPS, TRAFFIC_SOURCE_GROUPS, TRAFFIC_DAILY_CAP,
  TRAFFIC_RETENTION_DAYS, TRAFFIC_MAX_BODY_BYTES, TRAFFIC_DAY_MS,
  trafficConfiguration, trafficUtcDay, validTrafficEvent,
  type TrafficEvent, type TrafficFlags, type TrafficReport, type TrafficDay,
  type TrafficCleanupHealth, type TrafficPageGroup, type TrafficSourceGroup,
} from './traffic-metrics';

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
  // One conditional statement is serialized by SQLite/D1, including cross-dimension increments.
  const row = await db.prepare(trafficSql.record).bind(day, event.pageGroup, event.sourceGroup, day, TRAFFIC_DAILY_CAP).first();
  return row !== null;
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
  if (!validTrafficEvent(event)) return response(400, 'Invalid event.');
  const now = deps.now?.() ?? Date.now();
  const configuration = trafficConfiguration(deps.env(), now);
  if (!configuration.enabled) return response(204);
  try { await recordTraffic(deps.database(), event, now); return response(204); }
  catch { return response(503, 'Traffic recording is temporarily unavailable.'); }
}
const emptyDay = (date: string): TrafficDay => ({
  date, events: 0, capReached: false,
  byPageGroup: TRAFFIC_PAGE_GROUPS.map(pageGroup => ({ pageGroup, events: 0 })),
  bySourceGroup: TRAFFIC_SOURCE_GROUPS.map(sourceGroup => ({ sourceGroup, events: 0 })),
});
const limitations = [
  'Counts are accepted page-view events, not unique visitors, confirmed humans, conversions, or attributable sales.',
  'Opt-outs, blocked scripts, known administrators and QA visits are excluded. Anonymous staff and bots cannot be reliably identified.',
  'Blank or missing referrers do not establish direct traffic or absence of AI referrals.',
  'Dates before activation are unavailable. Zero means no accepted events recorded, not no visitors. Collection pauses or failures can reduce counts.',
  'Totals include completed UTC days only. The activation day and current day are reported separately when partial.',
  'Only the current UTC date and preceding 89 dates are retained. A daily scheduled sweep and recording/report requests perform deletion.',
];
export async function trafficReport(req: Request, deps: ReportDependencies): Promise<Response> {
  // Keep authorization ahead of query validation, environment inspection, and every storage call.
  try { await deps.requireAdmin(); } catch { return response(403, 'Administrator access is required.'); }
  const params = new URL(req.url).searchParams;
  const value = params.get('days');
  if (req.method !== 'GET' || [...params.keys()].some(key => key !== 'days') || params.getAll('days').length > 1
    || (value !== null && !['7', '30', '90'].includes(value))) return response(400, 'Choose 7, 30, or 90 days.');
  const days = (value === '7' ? 7 : value === '90' ? 90 : 30) as 7 | 30 | 90;
  const now = deps.now?.() ?? Date.now();
  try {
    const today = trafficUtcDay(now);
    const todayMs = Math.floor(now / TRAFFIC_DAY_MS) * TRAFFIC_DAY_MS;
    const requestedFrom = Math.max(0, todayMs - days * TRAFFIC_DAY_MS);
    const retainedFrom = Math.max(0, todayMs - (TRAFFIC_RETENTION_DAYS - 1) * TRAFFIC_DAY_MS);
    const configuration = trafficConfiguration(deps.env(), now);
    const started = configuration.startedAt ? Date.parse(configuration.startedAt) : null;
    const available = started !== null && started <= now;
    const db = deps.database();
    const cleanup = await cleanupTraffic(db, now);
    const from = Math.max(requestedFrom, retainedFrom, available ? Math.floor(started! / TRAFFIC_DAY_MS) * TRAFFIC_DAY_MS : todayMs);
    const rows = available ? (await db.prepare('SELECT day,page_group,source_group,event_count FROM traffic_daily WHERE day>=? AND day<=? ORDER BY day,page_group,source_group')
      .bind(trafficUtcDay(from), today).all<{ day: string; page_group: TrafficPageGroup; source_group: TrafficSourceGroup; event_count: number }>()).results : [];
    const grouped = new Map<string, TrafficDay>();
    if (available) for (let day = from; day <= todayMs; day += TRAFFIC_DAY_MS) grouped.set(trafficUtcDay(day), emptyDay(trafficUtcDay(day)));
    for (const row of rows) {
      const day = grouped.get(row.day);
      if (!day || !TRAFFIC_PAGE_GROUPS.includes(row.page_group) || !TRAFFIC_SOURCE_GROUPS.includes(row.source_group)
        || !Number.isSafeInteger(row.event_count) || row.event_count < 1 || row.event_count > TRAFFIC_DAILY_CAP) throw new Error('Invalid aggregate.');
      day.events += row.event_count;
      if (day.events > TRAFFIC_DAILY_CAP) throw new Error('Invalid daily aggregate.');
      day.capReached = day.events >= TRAFFIC_DAILY_CAP;
      day.byPageGroup.find(item => item.pageGroup === row.page_group)!.events += row.event_count;
      day.bySourceGroup.find(item => item.sourceGroup === row.source_group)!.events += row.event_count;
    }
    const activationDate = available ? trafficUtcDay(started!) : null;
    const partialActivation = available && started! % TRAFFIC_DAY_MS !== 0;
    const allDays = [...grouped.values()];
    const completedDays = allDays.filter(day => day.date !== today && !(partialActivation && day.date === activationDate));
    const totals = emptyDay('');
    for (const day of completedDays) {
      totals.events += day.events;
      day.byPageGroup.forEach((entry, i) => { totals.byPageGroup[i].events += entry.events; });
      day.bySourceGroup.forEach((entry, i) => { totals.bySourceGroup[i].events += entry.events; });
    }
    const report: TrafficReport = {
      asOf: new Date(now).toISOString(), status: available ? 'available' : 'unavailable', configuration,
      window: { requestedDays: days, timeZone: 'UTC', start: trafficUtcDay(from), endExclusive: today, retainedFrom: trafficUtcDay(retainedFrom) },
      completedDays,
      activationDayPartial: partialActivation && activationDate !== today ? grouped.get(activationDate!) || null : null,
      partialToday: available ? grouped.get(today) || null : null,
      totals: { events: available && completedDays.length > 0 ? totals.events : null, byPageGroup: available && completedDays.length > 0 ? totals.byPageGroup : [], bySourceGroup: available && completedDays.length > 0 ? totals.bySourceGroup : [] },
      cap: { dailyLimit: TRAFFIC_DAILY_CAP, daysReached: allDays.filter(day => day.capReached).map(day => day.date) }, cleanup, limitations,
    };
    return new Response(JSON.stringify(report), { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch { return response(503, 'Traffic reporting is temporarily unavailable.'); }
}
