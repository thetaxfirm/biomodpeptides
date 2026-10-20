// Once a day (9 AM Pacific): one email to the order-notify list naming every parcel that needs a person.
// Labels the carrier has not scanned in a day, parcels with no carrier update in four days, and parcels
// the carrier is returning or failed to deliver. Internal only; customers are never emailed. Nothing is
// sent when every parcel is moving (owner, Oct 17 2026).
import { stalledLabel, stuckInTransit, unshippedTooLong, unreadableParcel, flagDismissed, paidAt, carrierWords, type FulfillmentOrder } from './fulfillment';
import { orderNotifyRecipients } from './order-summary';

type Environment = { DB: D1Database } & Record<string, any>;
export type ParcelAlert = { id: string; kind: 'unscanned' | 'stuck' | 'problem' | 'unshipped'; name: string; place: string; since: number; droppedOff: boolean; unreadable: boolean; carrier: string; why?: string };

const STATE_KEY = 'parcel_alert_digest_v1';
const problems = new Set(['return_to_sender', 'failure', 'error']);
const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const pacificHour = (now: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now)) % 24;

/** Why a paid order has not reached the carrier, so the line says what to do rather than only that it is late. */
function unshippedReason(data: Record<string, any>): string {
    if (data.hold) {
        const note = typeof data.hold?.issue === 'string' ? data.hold.issue.replaceAll('_', ' ') : '';
        return 'on hold' + (note ? ': ' + note : '') + '. Clear the hold or contact the customer.';
    }
    const quoted = Number(data.labelApproval?.cents);
    if (Number.isFinite(quoted) && quoted > 0) return 'postage quoted at $' + (quoted / 100).toFixed(2) + ', above the automatic limit. Approve it by buying the label.';
    if (data.shipment) return 'postage bought, not yet scanned by the carrier. Check the box was posted.';
    return 'no postage bought yet. Check automatic purchase is on and the address is valid.';
}

/** Parcels in flight that need a person, oldest first. Archived and internal-test orders are left out. */
export async function parcelAlerts(env: Environment, now = Date.now()): Promise<ParcelAlert[]> {
    // Orders with a parcel to chase, and paid orders that have not produced one yet: an order nobody
    // ever bought postage for has no tracking to match on, and used to be invisible to this digest.
    const horizon = now - 60 * 86400000;
    const rows = (await env.DB.prepare(`SELECT id,status,data,created FROM orders
        WHERE status IN ('paid','labeling','shipped','delivered')
          AND json_extract(data,'$.internalTest') IS NULL AND json_extract(data,'$.archivedAt') IS NULL
          AND (json_extract(data,'$.shipment.tracking') IS NOT NULL OR status IN ('paid','labeling'))
          AND (coalesce(json_extract(data,'$.labelCreatedAt'),0) > ? OR created > ?)`)
        .bind(horizon, horizon).all<{ id: string; status: string; data: string; created: number }>()).results || [];
    const out: ParcelAlert[] = [];
    for (const row of rows) {
        let data: Record<string, any> = {};
        try { data = JSON.parse(row.data); } catch { continue; }
        const order = { status: row.status, data, created: row.created } as FulfillmentOrder & { created: number };
        const carrier = String(data.shipment?.status || '');
        // Most specific reason wins, so one order is named once and the line says what to do about it.
        const kind = problems.has(carrier) ? 'problem'
            : stuckInTransit(order, now) ? 'stuck'
            : stalledLabel(order, now) ? 'unscanned'
            : unshippedTooLong(order, now) ? 'unshipped' : null;
        if (!kind || row.status === 'delivered' && kind !== 'problem') continue;
        // A flag the owner has already accepted is not news. It comes back by itself if the carrier
        // changes its mind, because the dismissal is tied to the status it was given for.
        if (kind !== 'unshipped' && flagDismissed(order)) continue;
        const paid = paidAt(order);
        out.push({
            id: row.id, kind, name: String(data.address?.name || '').slice(0, 80),
            place: [data.address?.city, data.address?.state].filter(Boolean).join(', ').slice(0, 80),
            since: kind === 'unscanned' ? Number(data.labelCreatedAt)
                : kind === 'unshipped' ? Number(paid)
                : Number(data.shipment?.checkedAt) || Number(data.labelCreatedAt),
            droppedOff: Number.isFinite(data.handoff?.at), unreadable: unreadableParcel(order), carrier: carrierWords[carrier] || carrier,
            ...(kind === 'unshipped' ? { why: unshippedReason(data) } : {}),
        });
    }
    return out.sort((a, b) => a.since - b.since);
}

export function parcelAlertText(alerts: ParcelAlert[], now = Date.now()): string {
    const days = (since: number) => Math.max(1, Math.floor((now - since) / 86400000));
    const line = (a: ParcelAlert) => '- #' + a.id.slice(0, 8).toUpperCase() + ' ' + [a.name, a.place].filter(Boolean).join(', ');
    const group = (title: string, list: ParcelAlert[], detail: (a: ParcelAlert) => string) => list.length ? [title, ...list.map(a => line(a) + ': ' + detail(a)), ''] : [];
    return [
        ...group('Not scanned by the carrier (label bought over a day ago):', alerts.filter(a => a.kind === 'unscanned'),
            a => 'label ' + days(a.since) + 'd old, ' + (a.unreadable
                ? 'and the carrier will not return tracking for it. Open the shipment in EasyPost: the label may be cancelled or the tracking code wrong. The box may well be moving.'
                : a.droppedOff ? 'marked dropped off. Ask the post office for an acceptance scan.' : 'never marked dropped off. Find the box.')),
        ...group('No carrier update in 4+ days:', alerts.filter(a => a.kind === 'stuck'), a => 'last update ' + days(a.since) + 'd ago. Consider a carrier inquiry.'),
        ...group('Carrier problem:', alerts.filter(a => a.kind === 'problem'), a => a.carrier + '. Contact the customer.'),
        ...group('Paid but not shipped after 48 hours:', alerts.filter(a => a.kind === 'unshipped'),
            a => 'paid ' + days(a.since) + 'd ago, ' + (a.why || 'still not with the carrier.')),
        'Open the queue: https://trybiomod.com/admin?tab=orders',
    ].join('\n');
}

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
    const to = orderNotifyRecipients(env);
    const from = String(env.ORDER_EMAIL_FROM || 'BIOMOD Orders <contact@trybiomod.com>');
    if (!to.length || !String(env.RESEND_API_KEY || '').trim()) return { sent: false, reason: 'mail_unconfigured' };
    const subject = alerts.length + (alerts.length === 1 ? ' parcel needs' : ' parcels need') + ' a look';
    const response = await (deps.fetch || fetch)('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY).trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'parcel-alerts-' + today },
        body: JSON.stringify({ from, to, subject, text: parcelAlertText(alerts, now) }), redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    return { sent: response.ok, reason: response.ok ? 'sent' : 'provider_rejected', count: alerts.length };
}
