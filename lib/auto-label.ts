// Automatic label purchase, and the recovery that makes it safe to run unattended.
//
// Two jobs share this file because they are two halves of one guarantee. Buying a label is an
// external charge that cannot share a transaction with the order row, so an attempt can always end
// with the money spent and the outcome unknown. Recovery resolves those attempts: it adopts a label
// EasyPost already sold us, or releases the order so it can be tried again. Only once that exists is
// it safe to let a scheduler buy postage with nobody watching.
//
// Recovery runs whether or not automatic buying is switched on, because a manual purchase can strand
// an order the same way.
import { buyLabel, readBoughtLabel, sendTrackingEmail, type Label } from './easypost';
import { normalizeShippingOptions, savedShippingOption } from './shipping-options';
import { COA_REQUIRED_TO_SHIP } from './coa-shipping';

export type AutoLabelEnvironment = { DB: D1Database } & Record<string, unknown>;
export type AutoLabelHealth = {
    checkedAt: number; enabled: boolean;
    /** Recovery: attempts resolved into a saved label, and claims released for another try. */
    recovered: number; released: number;
    /** Buying: orders eligible, labels bought, attempts that failed, orders another writer took. */
    due: number; bought: number; failed: number; skipped: number;
    spentCents: number; capReached: boolean;
};

const int = (value: unknown, fallback: number, min: number, max: number) => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};
const DAY = 86400000;
/**
 * Owner settings, bounded. The delay is measured from the last time anything touched the order, so
 * staff working an order always postpones the purchase rather than racing it.
 */
export const autoLabelSettings = (stored: Record<string, unknown> | null | undefined, env: Record<string, unknown> = {}) => {
    const s = stored && typeof stored === 'object' ? stored : {};
    const pick = (key: string, envKey: string) => (s as Record<string, unknown>)[key] ?? env[envKey];
    return {
        enabled: typeof s.enabled === 'boolean' ? s.enabled : env.AUTO_LABEL_ENABLED !== 'false',
        delayMs: int(pick('delayMinutes', 'AUTO_LABEL_DELAY_MINUTES'), 20, 0, 1440) * 60000,
        dailyCapCents: int(pick('dailyCapCents', 'AUTO_LABEL_DAILY_CAP_CENTS'), 50000, 0, 10000000),
        perRunLimit: int(pick('perRunLimit', 'AUTO_LABEL_PER_RUN'), 10, 1, 50),
        stuckMs: int(pick('stuckMinutes', 'AUTO_LABEL_STUCK_MINUTES'), 5, 2, 120) * 60000,
    };
};

type StuckRow = { id: string; status: string; pending: string | null; auto: number | null };
type DueRow = { id: string; data: string };

/**
 * Every attempt that reached EasyPost but left no label on the order, whether the claim is still
 * held or was already released. These are the orders that may have been charged for, so they are
 * asked about first and regardless of the grace period — an order must never wait on a timer to be
 * told it already owns a label.
 */
const UNRESOLVED = `SELECT id, status, json_extract(data,'$.pendingShipmentId') AS pending, json_extract(data,'$.pendingAuto') AS auto
    FROM orders
    WHERE json_extract(data,'$.pendingShipmentId') IS NOT NULL
      AND json_extract(data,'$.shipment') IS NULL
      AND status IN ('paid','labeling')
      AND updated < ?
    ORDER BY updated ASC LIMIT 20`;
/** A claim older than the stuck threshold that never reached the carrier. Nothing to adopt; let it go. */
const ABANDONED = `SELECT id, status, NULL AS pending, NULL AS auto FROM orders
    WHERE status='labeling' AND json_extract(data,'$.pendingShipmentId') IS NULL AND updated < ?
    ORDER BY updated ASC LIMIT 20`;
/** Give the order back so it can be bought again. The recorded shipment stays so the retry resumes it. */
const RELEASE = `UPDATE orders SET status='paid',updated=? WHERE id=? AND status='labeling'`;
/**
 * Save a bought label without rewriting the order. Only these keys move, so a hold or a carrier
 * status written while the purchase was in flight survives. Only our own claim is released.
 */
const save = (auto: boolean) => `UPDATE orders SET
        status=CASE WHEN status='labeling' THEN 'paid' ELSE status END,
        data=json_remove(json_set(data,'$.tracking',?,'$.shipment',json(?),'$.labelCreatedAt',?${auto ? ",'$.labelAuto',json('true')" : ''}),'$.pendingShipmentId','$.pendingAuto'),
        updated=?
    WHERE id=?`;
/** Only labels this job bought count against the cap; the owner's own purchases are never blocked by it. */
const SPENT = `SELECT coalesce(sum(json_extract(data,'$.shipment.costCents')),0) AS cents
    FROM orders
    WHERE json_extract(data,'$.labelAuto') IS NOT NULL
      AND coalesce(json_extract(data,'$.labelCreatedAt'),0) >= ?`;
/** Paid, unlabelled, not held, not a test, and untouched for the grace period. Oldest order first. */
const DUE = `SELECT id, data FROM orders
    WHERE status='paid'
      AND json_extract(data,'$.shipment') IS NULL
      AND json_extract(data,'$.hold') IS NULL
      AND json_extract(data,'$.internalTest') IS NULL
      AND updated <= ?
    ORDER BY created ASC
    LIMIT ?`;
/** The same claim the admin button takes, so the two can never buy for one order at the same time. */
const CLAIM = `UPDATE orders SET status='labeling',updated=? WHERE id=? AND status='paid'
    AND json_extract(data,'$.shipment') IS NULL AND json_extract(data,'$.hold') IS NULL`;

/**
 * The reply address the tracking email must carry. sendTrackingEmail refuses to send without a
 * configured one, so an unset address means no automatic tracking email rather than a wrong sender.
 */
const replyAddress = async (env: AutoLabelEnvironment) => {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='coa_delivery_v1'`).first<{ value: string }>();
        const reply = row?.value ? JSON.parse(row.value)?.replyTo : '';
        return typeof reply === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(reply.trim()) ? reply.trim() : '';
    } catch { return ''; }
};
const settingsRow = async (env: AutoLabelEnvironment) => {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='store'`).first<{ value: string }>();
        const parsed = row?.value ? JSON.parse(row.value) : {};
        return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
    } catch { return {}; }
};

export async function runAutoLabels(env: AutoLabelEnvironment, now = Date.now()): Promise<AutoLabelHealth> {
    const stored = await settingsRow(env);
    const settings = autoLabelSettings(stored.autoLabel, env as Record<string, unknown>);
    const health: AutoLabelHealth = {
        checkedAt: now, enabled: settings.enabled,
        recovered: 0, released: 0, due: 0, bought: 0, failed: 0, skipped: 0, spentCents: 0, capReached: false,
    };
    const writeLabel = (auto: boolean, label: Label, id: string) =>
        env.DB.prepare(save(auto)).bind(label.carrier + ' ' + label.tracking, JSON.stringify(label), now, now, id).run();

    // --- Recovery. Always runs: a manual purchase strands an order exactly the same way. ---
    const stuck: StuckRow[] = [];
    for (const query of [UNRESOLVED, ABANDONED]) {
        try { stuck.push(...((await env.DB.prepare(query).bind(now - settings.stuckMs).all<StuckRow>()).results || [])); }
        catch { /* the other half of recovery still runs */ }
    }
    for (const row of stuck) {
        let label: Label | null = null;
        if (typeof row.pending === 'string' && row.pending) {
            // Ask the carrier what actually happened before deciding. A sold label is never abandoned.
            try { label = await readBoughtLabel(env as never, row.pending); }
            catch { continue; }
        }
        try {
            // Adopting is what recovers the money; releasing only hands back a claim nobody is using.
            if (label) { await writeLabel(row.auto === 1, label, row.id); health.recovered += 1; }
            else if (row.status === 'labeling') { await env.DB.prepare(RELEASE).bind(now, row.id).run(); health.released += 1; }
        } catch { health.failed += 1; }
    }

    // --- Buying. ---
    if (!settings.enabled) return health;
    // The rule cannot be judged here without today's catalog, so the job stands down rather than guess.
    if (COA_REQUIRED_TO_SHIP) return health;

    try {
        const spent = await env.DB.prepare(SPENT).bind(now - DAY).first<{ cents: number }>();
        health.spentCents = Number(spent?.cents) || 0;
    } catch { return health; }
    if (health.spentCents >= settings.dailyCapCents) { health.capReached = true; return health; }

    let due: DueRow[] = [];
    try { due = (await env.DB.prepare(DUE).bind(now - settings.delayMs, settings.perRunLimit).all<DueRow>()).results || []; }
    catch { return health; }
    health.due = due.length;

    const shippingOptions = normalizeShippingOptions(stored.shippingOptions, env as Record<string, string | undefined>);
    for (const row of due) {
        // Checked before every purchase, so one run can exceed the cap by at most a single label.
        if (health.spentCents >= settings.dailyCapCents) { health.capReached = true; break; }
        let data: Record<string, any>;
        try { data = JSON.parse(row.data); } catch { health.skipped += 1; continue; }
        if (!data.address) { health.skipped += 1; continue; }
        const selected = savedShippingOption(data.shippingOption);
        // A saved option that no longer validates is a human decision, not an automatic one.
        if (data.shippingOption && !selected) { health.skipped += 1; continue; }

        let claimed = false;
        try { claimed = Boolean((await env.DB.prepare(CLAIM).bind(now, row.id).run()).meta.changes); }
        catch { health.failed += 1; continue; }
        if (!claimed) { health.skipped += 1; continue; }

        let label: Label;
        try {
            label = await buyLabel(env as never, data.address, data.items || [], 'BIOMOD ' + row.id.slice(0, 8), selected || { shippingService: data.shippingService }, shippingOptions, {
                resumeShipmentId: typeof data.pendingShipmentId === 'string' ? data.pendingShipmentId : undefined,
                onShipment: async shipmentId => { await env.DB.prepare(`UPDATE orders SET data=json_set(data,'$.pendingShipmentId',?,'$.pendingAuto',json('true')),updated=? WHERE id=? AND status='labeling'`).bind(shipmentId, now, row.id).run(); },
            });
        } catch {
            // Release the claim and leave the recorded shipment: the next attempt resumes it.
            try { await env.DB.prepare(RELEASE).bind(now, row.id).run(); } catch { /* recovery will release it */ }
            health.failed += 1;
            continue;
        }
        try { await writeLabel(true, label, row.id); }
        catch { health.failed += 1; continue; }
        health.bought += 1;
        health.spentCents += label.costCents;
        // The customer is told the parcel exists. A mail failure never undoes a bought label.
        try { await sendTrackingEmail(env as never, data.email || '', row.id, label, data.address?.name, await replyAddress(env)); }
        catch { /* The tracking email is not what this job guarantees. */ }
    }
    return health;
}
