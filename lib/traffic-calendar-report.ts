import { TRAFFIC_DAILY_CAP, TRAFFIC_DAY_MS, TRAFFIC_RETENTION_DAYS, TRAFFIC_PAGE_GROUPS, TRAFFIC_SOURCE_GROUPS, trafficConfiguration, trafficUtcDay, type TrafficFlags, type TrafficCleanupHealth, type TrafficDay, type MetricsReportWindow } from './traffic-metrics';
import { SHOPPING_STAGES, shoppingConfiguration, type ShoppingDay } from './shopping-metrics';
import { calendarReportWindow, reportOptionsFromParams, reportDate, reportDayStart, reportDayBoundaries, addCalendarDays, ReportWindowError } from './report-window';

type Kind = 'traffic' | 'shopping';
type Dependencies = { env: () => TrafficFlags; database: () => D1Database; now?: () => number; requireAdmin: () => Promise<unknown> };
type Aggregate = { day: string; page_group?: typeof TRAFFIC_PAGE_GROUPS[number]; source_group?: typeof TRAFFIC_SOURCE_GROUPS[number]; stage?: typeof SHOPPING_STAGES[number]; event_count: number };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const emptyTrafficDay = (date: string): TrafficDay => ({ date, events: 0, capReached: false,
  byPageGroup: TRAFFIC_PAGE_GROUPS.map(pageGroup => ({ pageGroup, events: 0 })),
  bySourceGroup: TRAFFIC_SOURCE_GROUPS.map(sourceGroup => ({ sourceGroup, events: 0 })) });
const emptyShoppingDay = (date: string): ShoppingDay => ({ date, events: 0, capReached: false, byStage: SHOPPING_STAGES.map(stage => ({ stage, events: 0 })) });

/** Daily UTC history stays intact. Other zones use only the minute aggregates collected since rollout. */
export async function calendarMetricsReport(req: Request, deps: Dependencies, kind: Kind, cleanup: (db: D1Database, now: number) => Promise<TrafficCleanupHealth>): Promise<Response> {
  try { await deps.requireAdmin(); } catch { return json({ error: 'Administrator access is required.' }, 403); }
  const now = deps.now?.() ?? Date.now();
  try {
    const params = new URL(req.url).searchParams;
    if (req.method !== 'GET' || [...params.keys()].some(key => !['days', 'from', 'to', 'timeZone'].includes(key))) throw new ReportWindowError('Choose 7, 30, or 90 days, or a custom date range.');
    const options = reportOptionsFromParams(params);
    const selected = calendarReportWindow(params.get('days'), now, options, { defaultDays: 30, allowedDays: [7, 30, 90], clampStart: true });
    const local = selected.timeZone !== 'UTC', today = reportDate(now, selected.timeZone), todayStart = reportDayStart(today, selected.timeZone);
    const configuration = kind === 'traffic' ? trafficConfiguration(deps.env(), now) : shoppingConfiguration(deps.env(), now);
    const started = configuration.startedAt ? Date.parse(configuration.startedAt) : null;
    const retainedFrom = Math.max(0, Math.floor(now / TRAFFIC_DAY_MS) * TRAFFIC_DAY_MS - (TRAFFIC_RETENTION_DAYS - 1) * TRAFFIC_DAY_MS);
    const db = deps.database(), health = await cleanup(db, now);
    const precise = local ? await db.prepare('SELECT started_at FROM metrics_time_coverage WHERE kind=?').bind(kind).first<{ started_at: number }>() : null;
    if (precise && (!Number.isSafeInteger(precise.started_at) || precise.started_at < 0 || precise.started_at > now)) throw new Error('Invalid coverage.');
    const available = started !== null && started <= now && (!local || precise !== null);
    const coverage = available ? Math.max(started!, retainedFrom, local ? precise!.started_at : 0) : now;
    const intervals = reportDayBoundaries(selected);
    // Presets keep the established separate current-day context; historical custom reports stay in their requested period.
    if (!options.from) intervals.push({ date: today, start: todayStart, end: reportDayStart(addCalendarDays(today, 1), selected.timeZone, true) });
    const included = available ? intervals.filter(day => day.end > coverage && day.start <= now) : [];
    // Contemporary IANA offsets align to minutes. Never approximate an unsupported historical boundary.
    if (local && included.some(day => day.start % 60000 !== 0 || day.end % 60000 !== 0)) throw new ReportWindowError('That historical time-zone boundary is not supported by minute aggregates.');
    const from = included[0]?.start ?? Math.max(selected.start, reportDayStart(reportDate(coverage, selected.timeZone), selected.timeZone));
    const until = included.at(-1)?.end ?? from;
    const dimensions = kind === 'traffic' ? 'page_group,source_group' : 'stage';
    let rows: Aggregate[] = [], caps: { day: string; events: number }[] = [];
    if (included.length) {
      // Names are fixed internal enums. Dates and ranges remain bound values; the JSON array keeps 366-day queries under D1's parameter limit.
      const dailyTable = kind === 'traffic' ? 'traffic_daily' : 'shopping_daily';
      const minuteTable = kind === 'traffic' ? 'traffic_minute' : 'shopping_minute';
      caps = (await db.prepare(`SELECT day,SUM(event_count) events FROM ${dailyTable} WHERE day>=? AND day<=? GROUP BY day ORDER BY day`)
        .bind(trafficUtcDay(Math.max(from, retainedFrom)), trafficUtcDay(Math.min(until - 1, now))).all<{ day: string; events: number }>()).results;
      if (caps.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isSafeInteger(row.events) || row.events < 1 || row.events > TRAFFIC_DAILY_CAP)) throw new Error('Invalid daily cap aggregate.');
      if (local) {
        rows = (await db.prepare(`WITH dates AS (SELECT json_extract(value,'$.date') day,json_extract(value,'$.start') first,json_extract(value,'$.end') last FROM json_each(?))
          SELECT dates.day,${dimensions},SUM(event_count) event_count FROM dates JOIN ${minuteTable} ON bucket>=dates.first AND bucket<dates.last
          WHERE bucket>=? AND bucket<? GROUP BY dates.day,${dimensions} ORDER BY dates.day,${dimensions}`)
          .bind(JSON.stringify(included), retainedFrom, now + 1).all<Aggregate>()).results;
      } else rows = (await db.prepare(`SELECT day,${dimensions},event_count FROM ${dailyTable} WHERE day>=? AND day<? ORDER BY day,${dimensions}`)
        .bind(reportDate(from), reportDate(until)).all<Aggregate>()).results;
    }
    const makeDay = kind === 'traffic' ? emptyTrafficDay : emptyShoppingDay;
    const grouped = new Map<string, TrafficDay | ShoppingDay>(included.map(day => [day.date, makeDay(day.date)]));
    for (const row of rows) {
      const day = grouped.get(row.day);
      if (!day || !Number.isSafeInteger(row.event_count) || row.event_count < 1 || row.event_count > TRAFFIC_DAILY_CAP * (local ? 2 : 1)) throw new Error('Invalid aggregate.');
      day.events += row.event_count;
      if ('byStage' in day) {
        if (!row.stage || !SHOPPING_STAGES.includes(row.stage)) throw new Error('Invalid stage.');
        day.byStage.find(entry => entry.stage === row.stage)!.events += row.event_count;
      } else {
        if (!row.page_group || !row.source_group || !TRAFFIC_PAGE_GROUPS.includes(row.page_group) || !TRAFFIC_SOURCE_GROUPS.includes(row.source_group)) throw new Error('Invalid category.');
        day.byPageGroup.find(entry => entry.pageGroup === row.page_group)!.events += row.event_count;
        day.bySourceGroup.find(entry => entry.sourceGroup === row.source_group)!.events += row.event_count;
      }
      if (day.events > TRAFFIC_DAILY_CAP * (local ? 2 : 1)) throw new Error('Invalid daily aggregate.');
    }
    const capped = caps.filter(row => row.events >= TRAFFIC_DAILY_CAP).map(row => row.day);
    for (const interval of included) grouped.get(interval.date)!.capReached = capped.some(date => {
      const capStart = Date.parse(date + 'T00:00:00Z');
      return capStart < interval.end && capStart + TRAFFIC_DAY_MS > interval.start;
    });
    const completedDays = included.filter(day => day.start >= coverage && day.end <= todayStart && day.end <= selected.end).map(day => grouped.get(day.date)!);
    const totals = makeDay('');
    for (const day of completedDays) {
      totals.events += day.events;
      if ('byStage' in totals && 'byStage' in day) day.byStage.forEach((entry, i) => { totals.byStage[i].events += entry.events; });
      else if ('byPageGroup' in totals && 'byPageGroup' in day) {
        day.byPageGroup.forEach((entry, i) => { totals.byPageGroup[i].events += entry.events; });
        day.bySourceGroup.forEach((entry, i) => { totals.bySourceGroup[i].events += entry.events; });
      }
    }
    const hasCompleted = completedDays.length > 0;
    const window: MetricsReportWindow = { requestedDays: selected.days as number, timeZone: selected.timeZone,
      start: reportDate(from, selected.timeZone), endExclusive: reportDate(selected.end, selected.timeZone), retainedFrom: trafficUtcDay(retainedFrom),
      requestedFrom: reportDate(selected.start, selected.timeZone), requestedTo: reportDate(selected.end - 1, selected.timeZone),
      startInstant: selected.start, endInstant: selected.end, aggregation: local ? 'minute' : 'utc_daily', preciseFrom: precise ? new Date(precise.started_at).toISOString() : null };
    const partial = included.find(day => day.start < coverage && day.date !== today);
    const limitations = [
      kind === 'traffic' ? 'Counts are accepted page-view events, not unique visitors, confirmed humans, conversions, or attributable sales.' : 'Counts are accepted stage events, not unique people, linked journeys, conversion rates, abandonment rates or attributable sales.',
      'Opt-outs, blocked scripts, known administrators and QA visits are excluded. Anonymous staff and bots cannot be reliably identified. Collection pauses or failures can reduce counts.',
      kind === 'traffic' ? 'Blank or missing referrers do not establish direct traffic or absence of AI referrals.' : 'Only eligible-product carts in live checkout are measured. Repeated stages cannot be linked to people or summed into a visitor total. A checkout handoff does not establish a charge or paid order.',
      `Totals include completed calendar dates in ${selected.timeZone}. First partial coverage days and the current day are excluded. Zero means no accepted events recorded, not no activity.`,
      'Retention and the 50,000-event daily cap use UTC dates. Only the current UTC date and preceding 89 dates are retained; local dates intersecting a capped UTC date may be incomplete.',
      local ? 'Other time zones require minute aggregates collected since their first recorded coverage. Earlier UTC daily totals cannot be reconstructed into local dates and are unavailable.' : 'Historical UTC daily aggregates are preserved. They do not establish historical coverage for other time zones.',
    ];
    return json({ asOf: new Date(now).toISOString(), status: available ? 'available' : 'unavailable', configuration, window, completedDays,
      activationDayPartial: partial ? grouped.get(partial.date) : null, partialToday: grouped.get(today) ?? null,
      totals: 'byStage' in totals ? { events: hasCompleted ? totals.events : null, byStage: hasCompleted ? totals.byStage : [] }
        : { events: hasCompleted ? totals.events : null, byPageGroup: hasCompleted ? totals.byPageGroup : [], bySourceGroup: hasCompleted ? totals.bySourceGroup : [] },
      cap: { dailyLimit: TRAFFIC_DAILY_CAP, daysReached: capped }, cleanup: health, limitations });
  } catch (error) {
    return error instanceof ReportWindowError ? json({ error: error.message }, 400)
      : json({ error: kind === 'traffic' ? 'Traffic reporting is temporarily unavailable.' : 'Shopping-stage reporting is temporarily unavailable.' }, 503);
  }
}
