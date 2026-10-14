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
      AND coalesce(json_extract(data,'$.shipment.checkedAt'), json_extract(data,'$.labelCreatedAt'), created) < ?
      AND json_extract(data,'$.internalTest') IS NULL
    ORDER BY coalesce(json_extract(data,'$.shipment.checkedAt'), json_extract(data,'$.labelCreatedAt'), created) ASC
    LIMIT ?`;

/**
 * Exactly the transition the webhook makes, so both paths agree: record what the carrier says, move
 * paid to shipped once it is moving, and paid or shipped to delivered once it arrives. A newer
 * observation already stored always wins.
 */
const APPLY = `UPDATE orders SET
        data=json_set(data,'$.shipment.status',?,'$.shipment.checkedAt',?),
        status=CASE
            WHEN ?='delivered' AND status IN ('paid','shipped') THEN 'delivered'
            WHEN ? IN ('in_transit','out_for_delivery','available_for_pickup') AND status='paid' THEN 'shipped'
            ELSE status END,
        updated=?
    WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=?
      AND coalesce(json_extract(data,'$.shipment.checkedAt'),0)<=?`;

/**
 * One pass. Never throws for a single unreachable parcel: a carrier outage must not stop the rest,
 * and a parcel left unchecked is simply picked up on the next run.
 */
export async function runTrackingSweep(env: SweepEnvironment, now = Date.now()): Promise<SweepHealth> {
    const { staleMs, limit } = sweepSettings(env);
    const health: SweepHealth = { checkedAt: now, due: 0, read: 0, changed: 0, failed: 0, skipped: 0 };
    let due: Row[] = [];
    try {
        due = (await env.DB.prepare(DUE).bind(now - staleMs, limit).all<Row>()).results || [];
    } catch {
        health.failed += 1;
        return health;
    }
    health.due = due.length;
    for (const row of due) {
        if (typeof row.tracking !== 'string' || typeof row.shipmentId !== 'string') { health.skipped += 1; continue; }
        let status: string;
        try {
            status = await readShipmentTracking(env as never, row.shipmentId, row.tracking);
        } catch {
            health.failed += 1;
            continue;
        }
        health.read += 1;
        if (status === row.carrier) continue;
        try {
            const saved = await env.DB.prepare(APPLY).bind(status, now, status, status, now, row.id, row.shipmentId, now).run();
            if (saved.meta.changes) health.changed += 1;
        } catch {
            health.failed += 1;
        }
    }
    return health;
}
