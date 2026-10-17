// Once a day (9 AM Pacific): one email to the order-notify list naming every parcel that needs a person.
// Labels the carrier has not scanned in a day, parcels with no carrier update in four days, and parcels
// the carrier is returning or failed to deliver. Internal only; customers are never emailed. Nothing is
// sent when every parcel is moving (owner, Oct 17 2026).
import { stalledLabel, stuckInTransit, carrierWords, type FulfillmentOrder } from './fulfillment';
import { orderNotifyRecipients } from './order-summary';

type Environment = { DB: D1Database } & Record<string, any>;
export type ParcelAlert = { id: string; kind: 'unscanned' | 'stuck' | 'problem'; name: string; place: string; since: number; droppedOff: boolean; carrier: string };

const STATE_KEY = 'parcel_alert_digest_v1';
const problems = new Set(['return_to_sender', 'failure', 'error']);
const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const pacificHour = (now: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now)) % 24;

/** Parcels in flight that need a person, oldest first. Archived and internal-test orders are left out. */
export async function parcelAlerts(env: Environment, now = Date.now()): Promise<ParcelAlert[]> {
    const rows = (await env.DB.prepare(`SELECT id,status,data FROM orders
        WHERE status IN ('paid','shipped','delivered') AND json_extract(data,'$.shipment.tracking') IS NOT NULL
          AND json_extract(data,'$.internalTest') IS NULL AND json_extract(data,'$.archivedAt') IS NULL
          AND coalesce(json_extract(data,'$.labelCreatedAt'),0) > ?`).bind(now - 60 * 86400000).all<{ id: string; status: string; data: string }>()).results || [];
    const out: ParcelAlert[] = [];
    for (const row of rows) {
        let data: Record<string, any> = {};
        try { data = JSON.parse(row.data); } catch { continue; }
        const order = { status: row.status, data } as FulfillmentOrder;
        const carrier = String(data.shipment?.status || '');
        const kind = problems.has(carrier) ? 'problem' : stuckInTransit(order, now) ? 'stuck' : stalledLabel(order, now) ? 'unscanned' : null;
        if (!kind || row.status === 'delivered' && kind !== 'problem') continue;
        out.push({
            id: row.id, kind, name: String(data.address?.name || '').slice(0, 80),
            place: [data.address?.city, data.address?.state].filter(Boolean).join(', ').slice(0, 80),
            since: kind === 'unscanned' ? Number(data.labelCreatedAt) : Number(data.shipment?.checkedAt) || Number(data.labelCreatedAt),
            droppedOff: Number.isFinite(data.handoff?.at), carrier: carrierWords[carrier] || carrier,
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
            a => 'label ' + days(a.since) + 'd old, ' + (a.droppedOff ? 'marked dropped off. Ask the post office for an acceptance scan.' : 'never marked dropped off. Find the box.')),
        ...group('No carrier update in 4+ days:', alerts.filter(a => a.kind === 'stuck'), a => 'last update ' + days(a.since) + 'd ago. Consider a carrier inquiry.'),
        ...group('Carrier problem:', alerts.filter(a => a.kind === 'problem'), a => a.carrier + '. Contact the customer.'),
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
