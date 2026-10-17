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
import { recordChange } from './change-history';
import { normalizeShippingOptions, savedShippingOption, goodsValueCents } from './shipping-options';
import { COA_REQUIRED_TO_SHIP } from './coa-shipping';

export type AutoLabelEnvironment = { DB: D1Database } & Record<string, unknown>;
export type AutoLabelHealth = {
    checkedAt: number; enabled: boolean;
    /** Recovery: attempts resolved into a saved label, and claims released for another try. */
    recovered: number; released: number;
    /** Buying: orders eligible, labels bought, attempts that failed, orders another writer took. */
    due: number; bought: number; failed: number; skipped: number;
    /** Orders that failed too many times and were handed to a person. */
    blocked: number;
    /** Orders whose label costs more than the ceiling, now waiting for a person to approve the price. */
    needsApproval: number;
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
        /** No single automatic label may cost more than this. Above it, a person decides. */
        maxLabelCents: int(pick('maxLabelCents', 'AUTO_LABEL_MAX_LABEL_CENTS'), 7500, 100, 100000),
        /** After this many failed attempts the order stops being retried and asks for a human. */
        maxAttempts: int(pick('maxAttempts', 'AUTO_LABEL_MAX_ATTEMPTS'), 3, 1, 20),
    };
};

type StuckRow = { id: string; status: string; pending: string | null; auto: number | null };
type DueRow = { id: string; data: string; attempts: number };

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
        data=json_remove(json_set(data,'$.tracking',?,'$.shipment',json(?),'$.labelCreatedAt',?${auto ? ",'$.labelAuto',json('true')" : ''}),'$.pendingShipmentId','$.pendingAuto','$.labelAttempts','$.labelApproval'),
        updated=?
    WHERE id=?`;
/** Only labels this job bought count against the cap; the owner's own purchases are never blocked by it. */
const SPENT = `SELECT coalesce(sum(json_extract(data,'$.shipment.costCents')),0) AS cents
    FROM orders
    WHERE json_extract(data,'$.labelAuto') IS NOT NULL
      AND coalesce(json_extract(data,'$.labelCreatedAt'),0) >= ?`;
/**
 * Paid, unlabelled, not held, not a test, and untouched for the grace period. Oldest order first.
 *
 * An order already quoted above the ceiling is left out, so an expensive label is never retried in a
 * loop. The comparison is against today's ceiling rather than the marker's presence: raise the limit
 * past what was quoted and the order simply becomes due again, with no extra step.
 */
const DUE = `SELECT id, data, coalesce(json_extract(data,'$.labelAttempts'),0) AS attempts FROM orders
    WHERE status='paid'
      AND json_extract(data,'$.shipment') IS NULL
      AND json_extract(data,'$.hold') IS NULL
      AND json_extract(data,'$.internalTest') IS NULL
      AND coalesce(json_extract(data,'$.labelApproval.cents'),0) <= ?
      AND updated <= ?
    ORDER BY created ASC
    LIMIT ?`;
/** One more failed attempt on the record. Counted on the order so it survives a restart. */
const COUNT_ATTEMPT = `UPDATE orders SET data=json_set(data,'$.labelAttempts',coalesce(json_extract(data,'$.labelAttempts'),0)+1),updated=? WHERE id=?`;
/**
 * Stop trying and tell someone. A hold is the mechanism the store already has for "a human must look
 * at this": it moves the order into Needs review and blocks both automatic and manual purchase until
 * it is cleared, which is exactly right for an address or service the carrier keeps refusing.
 */
const BLOCK = `UPDATE orders SET data=json_set(data,'$.hold',json(?)),updated=? WHERE id=? AND json_extract(data,'$.hold') IS NULL`;
/**
 * A label that costs more than the ceiling. Deliberately not a hold: a hold blocks the Buy button,
 * and buying it by hand is exactly the approval being asked for. This marker moves the order into
 * Needs review and out of the automatic queue, while leaving every manual action available.
 */
const NEEDS_APPROVAL = `UPDATE orders SET data=json_set(data,'$.labelApproval',json(?)),updated=? WHERE id=?`;
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
/**
 * null means "we could not read the settings". That is not the same as "nothing is configured":
 * defaulting to enabled there would let a database hiccup resurrect a job the owner switched off,
 * so the caller treats null as a reason to stand down rather than a reason to use defaults.
 */
const settingsRow = async (env: AutoLabelEnvironment): Promise<Record<string, any> | null> => {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='store'`).first<{ value: string }>();
        if (!row?.value) return {};
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
    } catch { return null; }
};
/** Health is written where the admin can read it, so a job that quietly stops is visible. */
const HEALTH_KEY = 'auto_label_health_v1';
const saveHealth = async (env: AutoLabelEnvironment, health: AutoLabelHealth, status: string) => {
    try { await env.DB.prepare(`INSERT INTO settings(key,value) VALUES('${HEALTH_KEY}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify({ ...health, status })).run(); }
    catch { /* health is a report, never the thing that fails a run */ }
};
/** What the last run did, for the admin. Never throws: a missing report is not an outage. */
export async function readAutoLabelHealth(env: AutoLabelEnvironment): Promise<(AutoLabelHealth & { status: string }) | null> {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='${HEALTH_KEY}'`).first<{ value: string }>();
        return row?.value ? JSON.parse(row.value) : null;
    } catch { return null; }
}

export async function runAutoLabels(env: AutoLabelEnvironment, now = Date.now()): Promise<AutoLabelHealth> {
    const stored = await settingsRow(env);
    const settings = autoLabelSettings(stored?.autoLabel, env as Record<string, unknown>);
    const health: AutoLabelHealth = {
        checkedAt: now, enabled: stored !== null && settings.enabled,
        recovered: 0, released: 0, due: 0, bought: 0, failed: 0, skipped: 0, blocked: 0, needsApproval: 0, spentCents: 0, capReached: false,
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
    // Settings we could not read are not permission to spend money.
    if (stored === null) { await saveHealth(env, health, 'settings_unreadable'); return health; }
    if (!settings.enabled) { await saveHealth(env, health, 'disabled'); return health; }
    // The rule cannot be judged here without today's catalog, so the job stands down rather than guess.
    if (COA_REQUIRED_TO_SHIP) { await saveHealth(env, health, 'coa_rule_on'); return health; }

    try {
        const spent = await env.DB.prepare(SPENT).bind(now - DAY).first<{ cents: number }>();
        health.spentCents = Number(spent?.cents) || 0;
    } catch { await saveHealth(env, health, 'spend_unreadable'); return health; }
    if (health.spentCents >= settings.dailyCapCents) { health.capReached = true; await saveHealth(env, health, 'cap_reached'); return health; }

    let due: DueRow[] = [];
    try { due = (await env.DB.prepare(DUE).bind(settings.maxLabelCents, now - settings.delayMs, settings.perRunLimit).all<DueRow>()).results || []; }
    catch { await saveHealth(env, health, 'queue_unreadable'); return health; }
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
                maxCents: settings.maxLabelCents,
                valueCents: goodsValueCents(data),
                onShipment: async shipmentId => { await env.DB.prepare(`UPDATE orders SET data=json_set(data,'$.pendingShipmentId',?,'$.pendingAuto',json('true')),updated=? WHERE id=? AND status='labeling'`).bind(shipmentId, now, row.id).run(); },
            });
        } catch (e) {
            // Release the claim and leave the recorded shipment: the next attempt resumes it.
            try { await env.DB.prepare(RELEASE).bind(now, row.id).run(); } catch { /* recovery will release it */ }
            // A price above the ceiling is not a failure, and retrying would only quote the same
            // price again. Record what it would cost and let the order wait for a person's decision.
            const quoted = e as { code?: string; cents?: number };
            if (quoted?.code === 'label_above_limit') {
                try {
                    await env.DB.prepare(NEEDS_APPROVAL).bind(JSON.stringify({ cents: Number(quoted.cents) || 0, limitCents: settings.maxLabelCents, at: now }), now, row.id).run();
                    health.needsApproval += 1;
                } catch { /* the marker is bookkeeping; never fail the run over it */ }
                continue;
            }
            health.failed += 1;
            // An order the carrier will never accept must not be retried forever in silence.
            try {
                await env.DB.prepare(COUNT_ATTEMPT).bind(now, row.id).run();
                if (Number(row.attempts) + 1 >= settings.maxAttempts) {
                    const held = await env.DB.prepare(BLOCK).bind(JSON.stringify({ issue: 'website', note: 'Automatic label purchase failed ' + (Number(row.attempts) + 1) + ' times. Buy the label by hand, or fix the address.', by: 'Automatic label purchase', at: now }), now, row.id).run();
                    if (held.meta.changes) health.blocked += 1;
                }
            } catch { /* the attempt count is bookkeeping; never fail the run over it */ }
            continue;
        }
        try { await writeLabel(true, label, row.id); }
        catch { health.failed += 1; continue; }
        health.bought += 1;
        health.spentCents += label.costCents;
        // The customer is told the parcel exists. A mail failure never undoes a bought label.
        let trackingSent = false;
        try { trackingSent = await sendTrackingEmail(env as never, data.email || '', row.id, label, data.address?.name, await replyAddress(env)); }
        catch { /* The tracking email is not what this job guarantees. */ }
        // Record the send so the Orders tab can show the customer was emailed and when
        // (owner, Oct 15 2026). Same wording as the admin path. A failed record never undoes the label.
        try {
            await recordChange(env.DB as never, { source: 'system', actor: 'Automatic label purchase', actorType: 'system', action: 'shipping.tracking_email', entityType: 'order', entityId: row.id,
                status: trackingSent ? 'succeeded' : 'observed', changes: [],
                summary: trackingSent ? 'Tracking email accepted by the mail provider. Inbox delivery is unconfirmed.' : 'Tracking email acceptance was not confirmed. Review mail provider records before resending.' });
        } catch { /* history is best-effort here */ }
    }
    await saveHealth(env, health, 'completed');
    return health;
}
