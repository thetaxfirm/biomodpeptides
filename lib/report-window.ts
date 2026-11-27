/** Calendar reporting dates are inclusive in the UI and exclusive instants in every query. */
export type ReportOptions = { from?: string | null; to?: string | null; timeZone?: string | null };
export type ReportOptionsInput = ReportOptions | URLSearchParams;
export type ReportWindow = { days: number | 'all'; start: number; end: number; timeZone: string };
export type ReportDay = { date: string; start: number; end: number };
export class ReportWindowError extends Error { readonly status = 400; }
const DAY = 86400000;
export const MAX_REPORT_DAYS = 366;
const formatters = new Map<string, Intl.DateTimeFormat>();
const boundaries = new Map<string, number>();

export function reportTimeZone(value: string | null | undefined): string {
    if (value === null || value === undefined) return 'UTC';
    if (!value || value.length > 80 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) throw new ReportWindowError('Choose a valid IANA reporting time zone.');
    try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
    catch { throw new ReportWindowError('Choose a valid IANA reporting time zone.'); }
}

/** Call after authentication. Services also accept the raw params so they can enforce that order. */
export function reportOptionsFromParams(params: URLSearchParams): ReportOptions {
    for (const key of ['days', 'from', 'to', 'timeZone', 'complete']) if (params.getAll(key).length > 1) throw new ReportWindowError('Use each reporting parameter only once.');
    return { from: params.get('from'), to: params.get('to'), timeZone: reportTimeZone(params.get('timeZone')) };
}
export function reportOptions(input: ReportOptionsInput = {}): ReportOptions {
    return input instanceof URLSearchParams ? reportOptionsFromParams(input) : { ...input, timeZone: reportTimeZone(input.timeZone) };
}
function validDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const ms = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
export function reportDate(instant: number, timeZone = 'UTC'): string {
    if (timeZone === 'UTC') return new Date(instant).toISOString().slice(0, 10);
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
        formatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(instant);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function addCalendarDays(date: string, days: number): string {
    return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

/** Find the first instant of the date, including midnight DST gaps/folds and skipped dates. */
export function reportDayStart(date: string, timeZone = 'UTC', allowSkipped = false): number {
    if (!validDate(date)) throw new ReportWindowError('Use real calendar dates in YYYY-MM-DD format.');
    const naive = Date.parse(date + 'T00:00:00Z');
    if (timeZone === 'UTC') return naive;
    const key = timeZone + ':' + date + ':' + allowSkipped, cached = boundaries.get(key);
    if (cached !== undefined) return cached;
    let low = naive - 2 * DAY, high = naive + 2 * DAY;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (reportDate(middle, timeZone) < date) low = middle + 1;
        else high = middle;
    }
    if (!allowSkipped && reportDate(low, timeZone) !== date) throw new ReportWindowError('That calendar date does not exist in the selected time zone.');
    if (boundaries.size >= 2048) boundaries.delete(boundaries.keys().next().value!);
    boundaries.set(key, low);
    return low;
}

export function calendarReportWindow(value: string | null, now: number, input: ReportOptionsInput = {}, policy: { defaultDays: number; allowedDays: readonly number[]; allowAll?: boolean; includeToday?: boolean; clampStart?: boolean }): ReportWindow {
    if (!Number.isSafeInteger(now) || now < 0 || now >= Date.UTC(9999, 11, 31)) throw new ReportWindowError('Reporting time is unavailable.');
    const options = reportOptions(input), timeZone = options.timeZone!;
    const today = reportDate(now, timeZone), midnight = reportDayStart(today, timeZone);
    if (options.from !== null && options.from !== undefined || options.to !== null && options.to !== undefined) {
        if (value !== null) throw new ReportWindowError('Choose a preset period or custom dates, not both.');
        if (!options.from || !options.to || !validDate(options.from) || !validDate(options.to)) throw new ReportWindowError('Choose both a valid first and last calendar date.');
        const days = (Date.parse(options.to) - Date.parse(options.from)) / DAY + 1;
        if (days < 1 || days > MAX_REPORT_DAYS) throw new ReportWindowError(`Choose an ordered date range of at most ${MAX_REPORT_DAYS} days.`);
        if (options.to >= today) throw new ReportWindowError('Choose complete dates before today in the reporting time zone.');
        if (options.from < '1970-01-01') throw new ReportWindowError('Reporting dates must be on or after 1970-01-01.');
        reportDayStart(options.to, timeZone); // Reject a skipped date entered as the inclusive last day.
        return { days, start: reportDayStart(options.from, timeZone), end: reportDayStart(addCalendarDays(options.to, 1), timeZone, true), timeZone };
    }
    if (value !== null && !(policy.allowAll && value === 'all') && !policy.allowedDays.some(days => String(days) === value)) throw new ReportWindowError('Choose a supported reporting period.');
    const days = value === 'all' ? 'all' : value === null ? policy.defaultDays : Number(value);
    let start = days === 'all' ? 0 : reportDayStart(addCalendarDays(today, -(days - (policy.includeToday ? 1 : 0))), timeZone);
    if (policy.clampStart) start = Math.max(0, start);
    return { days, start, end: policy.includeToday ? now + 1 : midnight, timeZone };
}

export function reportDayBoundaries(window: ReportWindow): ReportDay[] {
    if (window.days === 'all' || window.days > MAX_REPORT_DAYS) throw new ReportWindowError('Daily reporting needs a bounded period.');
    const days: ReportDay[] = [];
    for (let date = reportDate(window.start, window.timeZone); date <= reportDate(window.end - 1, window.timeZone); date = addCalendarDays(date, 1)) {
        const start = reportDayStart(date, window.timeZone, true), end = reportDayStart(addCalendarDays(date, 1), window.timeZone, true);
        if (reportDate(start, window.timeZone) !== date) continue;
        days.push({ date, start: Math.max(window.start, start), end: Math.min(window.end, end) });
    }
    return days;
}
export function reportDateLabel(window: ReportWindow): string {
    return (window.days === 'all' ? 'All available history through ' : reportDate(window.start, window.timeZone) + ' through ') + reportDate(window.end - 1, window.timeZone) + ' (' + window.timeZone + ')';
}
