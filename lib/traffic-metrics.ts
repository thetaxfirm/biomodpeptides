// Shared constants and contracts only. No catalog, storage, auth, or server imports.
export const TRAFFIC_ORIGIN = 'https://trybiomod.com';
export const TRAFFIC_PAGE_GROUPS = ['home', 'catalog', 'product', 'documents', 'guide', 'about', 'locations', 'contact', 'policy'] as const;
export const TRAFFIC_SOURCE_GROUPS = ['search', 'ai', 'social', 'external_other', 'internal', 'direct_or_unavailable'] as const;
export const TRAFFIC_DAILY_CAP = 50000;
export const TRAFFIC_RETENTION_DAYS = 90;
export const TRAFFIC_MAX_BODY_BYTES = 256;
export const TRAFFIC_DAY_MS = 86400000;
export type TrafficPageGroup = typeof TRAFFIC_PAGE_GROUPS[number];
export type TrafficSourceGroup = typeof TRAFFIC_SOURCE_GROUPS[number];
export type TrafficEvent = { event: 'page_view'; pageGroup: TrafficPageGroup; sourceGroup: TrafficSourceGroup };
export type TrafficConfiguration = {
  enabled: boolean;
  reason: 'enabled' | 'flag_disabled' | 'start_missing_or_invalid' | 'start_in_future';
  startedAt: string | null;
};
export type TrafficFlags = Record<string, unknown> & { TRAFFIC_MEASUREMENT_ENABLED?: string; TRAFFIC_MEASUREMENT_STARTED_AT?: string };
export type TrafficPageCount = { pageGroup: TrafficPageGroup; events: number };
export type TrafficSourceCount = { sourceGroup: TrafficSourceGroup; events: number };
export type TrafficDay = { date: string; events: number; capReached: boolean; byPageGroup: TrafficPageCount[]; bySourceGroup: TrafficSourceCount[] };
export type TrafficCleanupHealth = {
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null;
  status: 'ok' | 'failed' | 'never'; retentionDays: number;
};
export type TrafficReport = {
  asOf: string; status: 'available' | 'unavailable'; configuration: TrafficConfiguration;
  window: { requestedDays: 7 | 30 | 90; timeZone: 'UTC'; start: string; endExclusive: string; retainedFrom: string };
  completedDays: TrafficDay[]; activationDayPartial: TrafficDay | null; partialToday: TrafficDay | null;
  totals: { events: number | null; byPageGroup: TrafficPageCount[]; bySourceGroup: TrafficSourceCount[] };
  cap: { dailyLimit: number; daysReached: string[] }; cleanup: TrafficCleanupHealth; limitations: string[];
};
export function validTrafficEvent(value: unknown): value is TrafficEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 && Object.prototype.hasOwnProperty.call(record, 'event')
    && Object.prototype.hasOwnProperty.call(record, 'pageGroup') && Object.prototype.hasOwnProperty.call(record, 'sourceGroup')
    && record.event === 'page_view'
    && TRAFFIC_PAGE_GROUPS.includes(record.pageGroup as TrafficPageGroup)
    && TRAFFIC_SOURCE_GROUPS.includes(record.sourceGroup as TrafficSourceGroup);
}
export function trafficConfiguration(env: TrafficFlags, now = Date.now()): TrafficConfiguration {
  const raw = env.TRAFFIC_MEASUREMENT_STARTED_AT;
  // Require a canonical UTC ISO timestamp: permissive Date.parse accepts invalid calendar dates.
  const parsed = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw) ? Date.parse(raw) : NaN;
  const normalized = Number.isSafeInteger(parsed) && parsed >= 0 ? new Date(parsed).toISOString() : null;
  if (!normalized || (raw !== normalized && raw !== normalized.replace('.000Z', 'Z'))) return { enabled: false, reason: 'start_missing_or_invalid', startedAt: null };
  if (!Number.isSafeInteger(now) || parsed > now) return { enabled: false, reason: 'start_in_future', startedAt: normalized };
  return { enabled: env.TRAFFIC_MEASUREMENT_ENABLED === 'true', reason: env.TRAFFIC_MEASUREMENT_ENABLED === 'true' ? 'enabled' : 'flag_disabled', startedAt: normalized };
}
export function trafficUtcDay(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) throw new Error('Reporting time is unavailable.');
  return new Date(now).toISOString().slice(0, 10);
}
