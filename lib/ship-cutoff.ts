// Same-day dispatch tracker (owner request, October 17, 2026). The published promise is in
// shipping-terms.ts: in-stock weekday orders placed before 2 p.m. Pacific normally process the same
// business day, excluding federal holidays. This decides, per order, the business day it has to go out
// and whether that day is today or already past. "Out" means handed to the carrier: marked Dropped off,
// marked dispatched, or scanned by the carrier. A bought label alone is not out.
import { orderHasPreorder, type FulfillmentOrder } from './fulfillment';

export const CUTOFF_HOUR_PACIFIC = 14;
const zone = 'America/Los_Angeles';
const pacificParts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** The Pacific calendar day (YYYY-MM-DD) and hour of a moment. */
export function pacific(at: number): { day: string; hour: number } {
    const p = Object.fromEntries(pacificParts.formatToParts(new Date(at)).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay();
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/** The nth given weekday of a month; n = -1 is the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
    if (n < 0) { const last = new Date(Date.UTC(y, m, 0)); return iso(y, m, last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7)); }
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((dow - first + 7) % 7) + 7 * (n - 1));
}
/** A fixed-date holiday on a Saturday is observed Friday; on a Sunday, Monday. */
function observed(y: number, m: number, d: number): string {
    const day = iso(y, m, d), w = weekday(day);
    return w === 6 ? addDays(day, -1) : w === 0 ? addDays(day, 1) : day;
}
const holidayCache = new Map<number, Set<string>>();
/** U.S. federal holidays (observed dates). USPS does not deliver or accept routine mail on them. */
export function federalHolidays(y: number): Set<string> {
    let set = holidayCache.get(y);
    if (!set) {
        set = new Set([observed(y, 1, 1), nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), nthWeekday(y, 5, 1, -1), observed(y, 6, 19), observed(y, 7, 4),
            nthWeekday(y, 9, 1, 1), nthWeekday(y, 10, 1, 2), observed(y, 11, 11), nthWeekday(y, 11, 4, 4), observed(y, 12, 25), observed(y + 1, 1, 1)]);
        holidayCache.set(y, set);
    }
    return set;
}
export function isBusinessDay(day: string): boolean {
    const w = weekday(day);
    return w !== 0 && w !== 6 && !federalHolidays(Number(day.slice(0, 4))).has(day);
}
export function nextBusinessDay(day: string): string {
    let next = addDays(day, 1);
    while (!isBusinessDay(next)) next = addDays(next, 1);
    return next;
}
/** The business day an order placed at this moment has to go out. */
export function dueDay(placedAt: number): string {
    const p = pacific(placedAt);
    return isBusinessDay(p.day) && p.hour < CUTOFF_HOUR_PACIFIC ? p.day : nextBusinessDay(p.day);
}

const scanned = new Set(['in_transit', 'out_for_delivery', 'available_for_pickup', 'delivered', 'return_to_sender', 'failure']);
/** Handed to the carrier: Dropped off, marked dispatched, or scanned. */
export function isOut(order: FulfillmentOrder): boolean {
    const d = order.data as Record<string, any> | undefined;
    if (Number.isFinite(d?.handoff?.at)) return true;
    if (['shipped', 'delivered'].includes(order.status)) return true;
    return scanned.has(String(d?.shipment?.status || ''));
}

export type ShipDue = { state: 'today' | 'late' | 'upcoming'; due: string; label: string };
const dayLabel = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * When this order has to go out, or null when the promise does not apply: unpaid, closed, internal
 * test, archived, preorder, held for a problem, or already out.
 */
export function shipDue(order: FulfillmentOrder & { created?: number }, now = Date.now()): ShipDue | null {
    const d = order.data as Record<string, any> | undefined;
    if (!['paid', 'labeling'].includes(order.status) || d?.internalTest || d?.hold || Number.isFinite(d?.archivedAt)) return null;
    if (typeof order.created !== 'number' || !Number.isFinite(order.created) || orderHasPreorder(d) || isOut(order)) return null;
    const due = dueDay(order.created), today = pacific(now).day;
    if (due < today) return { state: 'late', due, label: 'Late: was due ' + dayLabel(due) };
    if (due === today) return { state: 'today', due, label: 'Must go out today' };
    return { state: 'upcoming', due, label: 'Goes out ' + dayLabel(due) };
}
