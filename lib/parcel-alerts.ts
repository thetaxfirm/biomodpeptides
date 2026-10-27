// Once a day (9 AM Pacific): one message naming every order that has stopped moving.
//
// The owner gets exactly two alerts from this store and this is the second one (owner, Oct 27 2026).
// The first is a new order whose payment the provider has confirmed and captured. Everything else that
// used to mail the team — a line for each website message, a daily list of unanswered replies, separate
// thresholds for unscanned labels and unshipped orders — is gone, because a notification you learn to
// ignore is worse than no notification.
//
// One rule decides this digest: an order in flight that has shown no forward progress in four days.
// Whichever stage it is stuck at, the clock is the same, so there is one number to remember. The
// admin queue keeps its own finer-grained flags; those are there to be looked at, not to interrupt.
import { unreadableParcel, flagDismissed, carrierWords, type FulfillmentOrder } from './fulfillment';
import { orderAlertRecipients } from './order-summary';
import { sendTelegramText } from './telegram';

type Environment = { DB: D1Database } & Record<string, any>;
export type ParcelAlert = { id: string; kind: 'stalled' | 'problem'; name: string; place: string; since: number; droppedOff: boolean; unreadable: boolean; carrier: string; why: string };

const STATE_KEY = 'parcel_alert_digest_v1';
const DAY = 86400000;
/** Four days of nothing. The one number this digest is built on. */
export const STALLED_MS = 4 * DAY;
const problems = new Set(['return_to_sender', 'failure', 'error']);
const moving = new Set(['in_transit', 'out_for_delivery', 'available_for_pickup']);
const ADMIN = 'https://trybiomod.com/admin?tab=orders';
const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const pacificHour = (now: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now)) % 24;
const stamp = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The last moment this order visibly moved forward, newest evidence first: a carrier event, then the
 * label purchase, then the captured payment. `created` is the floor, so an order with none of those
 * still has a clock rather than looking brand new forever.
 */
export function lastMovedAt(data: Record<string, any>, created: number): number {
    return stamp(data?.shipment?.checkedAt) || stamp(data?.labelCreatedAt) || stamp(data?.paidAt) || created;
}

/** What is actually holding this order up, so the line says what to do rather than only that it is late. */
export function stalledReason(data: Record<string, any>, unreadable: boolean): string {
    if (data?.hold) {
        const note = typeof data.hold?.issue === 'string' ? data.hold.issue.replaceAll('_', ' ') : '';
        return 'on hold' + (note ? ': ' + note : '') + '. Clear the hold or contact the customer.';
    }
    const quoted = Number(data?.labelApproval?.cents);
    if (Number.isFinite(quoted) && quoted > 0) return 'postage quoted at $' + (quoted / 100).toFixed(2) + ', above the automatic limit. Approve it by buying the label.';
    if (!data?.shipment) return 'no postage bought yet. Check automatic purchase is on and the address is valid.';
    const carrier = String(data.shipment?.status || '');
    if (moving.has(carrier)) return 'in transit, but the carrier has not updated it. Consider a carrier inquiry.';
    if (unreadable) return 'the carrier will not return tracking for it. Open the shipment in EasyPost: the label may be cancelled or the tracking code wrong. The box may well be moving.';
    if (stamp(data.handoff?.at)) return 'marked dropped off but never scanned. Ask the post office for an acceptance scan.';
    return 'postage bought, never scanned and never marked dropped off. Find the box.';
}

/**
 * Orders that need a person, oldest first. Archived and internal-test orders are left out, and so is
 * anything already delivered: a delivered parcel has finished moving on purpose.
 */
export async function parcelAlerts(env: Environment, now = Date.now()): Promise<ParcelAlert[]> {
    const horizon = now - 60 * DAY;
    const rows = (await env.DB.prepare(`SELECT id,status,data,created FROM orders
        WHERE status IN ('paid','labeling','shipped')
          AND json_extract(data,'$.internalTest') IS NULL AND json_extract(data,'$.archivedAt') IS NULL
          AND (coalesce(json_extract(data,'$.labelCreatedAt'),0) > ? OR created > ?)`)
        .bind(horizon, horizon).all<{ id: string; status: string; data: string; created: number }>()).results || [];
    const out: ParcelAlert[] = [];
    for (const row of rows) {
        let data: Record<string, any> = {};
        try { data = JSON.parse(row.data); } catch { continue; }
        const order = { status: row.status, data, created: row.created } as FulfillmentOrder & { created: number };
        const carrier = String(data.shipment?.status || '');
        const since = lastMovedAt(data, row.created);
        // A carrier that says it is bringing the parcel back has not stalled, it has failed, and
        // waiting four more days to mention it would not make it any less true.
        const kind = problems.has(carrier) ? 'problem' : now - since > STALLED_MS ? 'stalled' : null;
        if (!kind) continue;
        // A flag the owner has already accepted is not news. It comes back by itself if the carrier
        // changes its mind, because the dismissal is tied to the status it was given for. Only
        // carrier-owned flags can be dismissed; an order with no parcel yet is the store's own problem.
        if (data.shipment && flagDismissed(order)) continue;
        const unreadable = unreadableParcel(order);
        out.push({
            id: row.id, kind,
            name: String(data.address?.name || '').slice(0, 80),
            place: [data.address?.city, data.address?.state].filter(Boolean).join(', ').slice(0, 80),
            since, droppedOff: Boolean(stamp(data.handoff?.at)), unreadable,
            carrier: carrierWords[carrier] || carrier,
            why: kind === 'problem' ? (carrierWords[carrier] || carrier) + '. Contact the customer.' : stalledReason(data, unreadable),
        });
    }
    return out.sort((a, b) => a.since - b.since);
}

const headline = (alerts: ParcelAlert[]): string => {
    const stalled = alerts.filter(a => a.kind === 'stalled').length;
    const problem = alerts.length - stalled;
    const parts: string[] = [];
    if (stalled) parts.push(stalled + (stalled === 1 ? ' order has' : ' orders have') + ' not moved in 4 days');
    if (problem) parts.push(problem + (problem === 1 ? ' parcel is' : ' parcels are') + ' coming back');
    return parts.join(', ');
};

export function parcelAlertText(alerts: ParcelAlert[], now = Date.now()): string {
    const days = (since: number) => Math.max(1, Math.floor((now - since) / DAY));
    const line = (a: ParcelAlert) => '- #' + a.id.slice(0, 8).toUpperCase() + ' ' + [a.name, a.place].filter(Boolean).join(', ') + ': ' + a.why;
    const group = (title: string, kind: ParcelAlert['kind'], detail: (a: ParcelAlert) => string) => {
        const list = alerts.filter(a => a.kind === kind);
        return list.length ? [title, ...list.map(a => line(a) + detail(a)), ''] : [];
    };
    return [
        ...group('Not moved in 4 days:', 'stalled', a => ' Stalled ' + days(a.since) + 'd.'),
        ...group('Carrier is returning it or could not deliver:', 'problem', () => ''),
        'Open the queue: ' + ADMIN,
    ].join('\n');
}

/** The phone version: one line, because the list belongs in the email. */
export const parcelAlertPush = (alerts: ParcelAlert[]): string => headline(alerts) + '\n' + ADMIN;

// A digest problem never fails the shared 5-minute schedule.
export async function runParcelAlerts(env: Environment, now = Date.now(), deps: { fetch?: typeof fetch } = {}) {
    try { return await digest(env, now, deps); } catch { return { sent: false, reason: 'failed' }; }
}
async function digest(env: Environment, now: number, deps: { fetch?: typeof fetch }) {
    if (pacificHour(now) < 9) return { sent: false, reason: 'too_early' };
    const today = pacificDay(now);
    const state = await env.DB.prepare(`SELECT value FROM settings WHERE key='${STATE_KEY}'`).first<{ value: string }>();
    if (state?.value === today) return { sent: false, reason: 'already_today' };
    const alerts = await parcelAlerts(env, now);
    // Record the day first so a slow provider can never produce two digests.
    await env.DB.prepare(`INSERT INTO settings(key,value) VALUES('${STATE_KEY}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(today).run();
    if (!alerts.length) return { sent: false, reason: 'all_moving' };
    // The phone is where the paid-order alert already lands, so this one goes there too. A chat app
    // is not the digest: it never decides whether the email is sent, and it never fails the run.
    let pushed = 0;
    try { pushed = await sendTelegramText(env as never, parcelAlertPush(alerts), deps); } catch { /* the email is the record */ }
    const to = await orderAlertRecipients(env);
    const from = String(env.ORDER_EMAIL_FROM || 'BIOMOD Orders <contact@trybiomod.com>');
    if (!to.length || !String(env.RESEND_API_KEY || '').trim()) return { sent: false, reason: 'mail_unconfigured', pushed, count: alerts.length };
    const response = await (deps.fetch || fetch)('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY).trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'parcel-alerts-' + today },
        body: JSON.stringify({ from, to, subject: headline(alerts), text: parcelAlertText(alerts, now) }), redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    return { sent: response.ok, reason: response.ok ? 'sent' : 'provider_rejected', count: alerts.length, pushed };
}
