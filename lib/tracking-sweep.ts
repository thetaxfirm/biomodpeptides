// Fail-safe for carrier tracking. The EasyPost webhook is the fast path: it records each
// tracker.updated event and moves a paid order to shipped, or a shipped one to delivered.
// A webhook can be missed — a dropped delivery, an outage, a label bought before the hook existed —
// and nothing would ever correct it. This sweep re-reads the carrier for parcels nobody has heard
// about in a while and applies the same transition, so a forgotten order still settles itself.
import { readShipmentTracking } from './easypost';

export type SweepEnvironment = { DB: D1Database } & Record<string, unknown>;
export type SweepHealth = { checkedAt: number; due: number; read: number; changed: number; failed: number; skipped: number };

/** Carrier states that are final enough to stop asking about. */
export const settled = new Set(['delivered', 'return_to_sender', 'failure', 'cancelled']);

const int = (value: unknown, fallback: number, min: number, max: number) => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};
/** How stale a parcel must be before the carrier is asked again, and how many to ask about per run. */
export const sweepSettings = (env: Record<string, unknown>) => ({
    staleMs: int(env.TRACKING_RECHECK_MINUTES, 180, 15, 10080) * 60000,
    limit: int(env.TRACKING_RECHECK_LIMIT, 15, 1, 100),
});

type Row = { id: string; status: string; tracking: string; shipmentId: string; carrier: string | null };

/** Parcels with a label, still in flight, that nobody has checked recently. Oldest silence first. */
const DUE = `SELECT id, status,
        json_extract(data,'$.shipment.tracking') AS tracking,
        json_extract(data,'$.shipment.shipmentId') AS shipmentId,
        json_extract(data,'$.shipment.status') AS carrier
    FROM orders
    WHERE status IN ('paid','shipped')
      AND json_extract(data,'$.shipment.shipmentId') IS NOT NULL
      AND json_extract(data,'$.shipment.tracking') IS NOT NULL
      AND coalesce(json_extract(data,'$.shipment.status'),'') NOT IN ('delivered','return_to_sender','failure','cancelled')
      AND coalesce(json_extract(data,'$.shipment.sweptAt'), json_extract(data,'$.shipment.checkedAt'), json_extract(data,'$.labelCreatedAt'), created) < ?
      AND json_extract(data,'$.internalTest') IS NULL
    ORDER BY coalesce(json_extract(data,'$.shipment.sweptAt'), json_extract(data,'$.shipment.checkedAt'), json_extract(data,'$.labelCreatedAt'), created) ASC
    LIMIT ?`;

/**
 * Exactly the transition the webhook makes, so both paths agree: record what the carrier says, move
 * paid to shipped once it is moving, and paid or shipped to delivered once it arrives. A newer
 * observation already stored always wins.
 */
const APPLY = `UPDATE orders SET
        data=json_remove(json_set(data,'$.shipment.status',?,'$.shipment.checkedAt',?,'$.shipment.sweptAt',?),'$.shipment.readFails'),
        status=CASE
            WHEN ?='delivered' AND status IN ('paid','shipped') THEN 'delivered'
            WHEN ? IN ('in_transit','out_for_delivery','available_for_pickup') AND status='paid' THEN 'shipped'
            ELSE status END,
        updated=?
    WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=?
      AND coalesce(json_extract(data,'$.shipment.checkedAt'),0)<=?`;

/**
 * Records that this parcel was asked about, whatever the answer. Nothing else is touched: not the
 * carrier status, not the order status, not `updated`.
 *
 * sweptAt is deliberately a different field from checkedAt. checkedAt is when the carrier last told
 * us something new, which is what the stuck-in-transit alert measures, so merely asking must never
 * reset it. sweptAt is only the queue's position marker. Without it a parcel whose status never
 * changes keeps the oldest timestamp in DUE, is re-read on every run, and once enough of them
 * collect to fill the per-run limit nothing behind them is ever reached again.
 */
const STAMP = `UPDATE orders SET data=json_remove(json_set(data,'$.shipment.sweptAt',?),'$.shipment.readFails')
    WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=?`;

/**
 * The same back-off, plus a count of consecutive reads the carrier refused. A parcel whose shipment
 * no longer matches at the provider — a cancelled label, a tracking code edited by hand, a shipment
 * from another account — can never be read again, and until this was counted it looked exactly like
 * a parcel the carrier simply had not scanned, so the daily digest told the team to go find a box
 * that was never the problem. The count is cleared by the first successful read.
 */
const STAMP_FAILED = `UPDATE orders SET data=json_set(data,'$.shipment.sweptAt',?,'$.shipment.readFails',coalesce(json_extract(data,'$.shipment.readFails'),0)+1)
    WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=?`;

/**
 * One pass. Never throws for a single unreachable parcel: a carrier outage must not stop the rest,
 * and a parcel left unchecked is simply picked up on the next run.
 */
const HEALTH_KEY = 'tracking_sweep_health_v1';
/** Recorded where the admin can read it, so a sweep that quietly stops running is visible. */
const saveHealth = async (env: SweepEnvironment, health: SweepHealth, status: string) => {
    try { await env.DB.prepare(`INSERT INTO settings(key,value) VALUES('${HEALTH_KEY}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify({ ...health, status })).run(); }
    catch { /* health is a report, never the thing that fails a run */ }
};
export async function readTrackingSweepHealth(env: SweepEnvironment) {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='${HEALTH_KEY}'`).first<{ value: string }>();
        return row?.value ? JSON.parse(row.value) : null;
    } catch { return null; }
}
export async function runTrackingSweep(env: SweepEnvironment, now = Date.now()): Promise<SweepHealth> {
    const { staleMs, limit } = sweepSettings(env);
    const health: SweepHealth = { checkedAt: now, due: 0, read: 0, changed: 0, failed: 0, skipped: 0 };
    let due: Row[] = [];
    try {
        due = (await env.DB.prepare(DUE).bind(now - staleMs, limit).all<Row>()).results || [];
    } catch {
        health.failed += 1;
        await saveHealth(env, health, 'queue_unreadable');
        return health;
    }
    health.due = due.length;
    const stamp = async (row: Row, unreadable = false) => {
        // A stamp that does not land leaves the parcel where it was: first in the queue next run.
        try { await env.DB.prepare(unreadable ? STAMP_FAILED : STAMP).bind(now, row.id, row.shipmentId).run(); } catch { /* reported by the outcome already counted */ }
    };
    for (const row of due) {
        if (typeof row.tracking !== 'string' || typeof row.shipmentId !== 'string') { health.skipped += 1; await stamp(row, true); continue; }
        let status: string | null = null;
        try {
            status = await readShipmentTracking(env as never, row.shipmentId, row.tracking);
            health.read += 1;
        } catch {
            // A carrier that cannot be reached still backs off, so one broken parcel cannot hold a
            // slot on every run. The webhook remains the fast path while this waits.
            health.failed += 1;
        }
        if (status === null) { await stamp(row, true); continue; }
        if (status === row.carrier) { await stamp(row); continue; }
        try {
            const saved = await env.DB.prepare(APPLY).bind(status, now, now, status, status, now, row.id, row.shipmentId, now).run();
            if (saved.meta.changes) health.changed += 1;
            else await stamp(row); // a newer stored observation won; still back off
        } catch {
            health.failed += 1;
            await stamp(row);
        }
    }
    await saveHealth(env, health, 'completed');
    return health;
}
