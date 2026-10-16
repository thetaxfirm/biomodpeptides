// An unpaid checkout used to last forever. Nothing expired it, so the stock it reserved was never
// released and its owner could not start another order: the catalogue still advertised the last
// unit of a product while no one could actually buy it, and the customer's only remaining
// instruction was to contact us. This releases a checkout once it is certainly dead.
//
// "Certainly dead" is the whole point, and it is decided by Authorize.net, never by a clock alone.
// A payment that exists, is pending, or is under review is never touched; only a verification that
// reports no payment at all releases anything. That is the same gate the recovery mailer uses
// before it offers a discount, and it is why a slow or silent provider loses stock rather than an
// order. Orders already held for review stay held: they are waiting on a person, not on time.
import { createPaymentAdapter, paymentEnvironment } from './payments';
import { unavailableOrder } from './catalog-visibility';
import { RECOVERY_DAY } from './checkout-recovery';

export type ExpiryEnvironment = Record<string, string | undefined> & { DB: D1Database };
export type ExpiryHealth = { status: string; checkedAt: number; due: number; released: number; kept: number; failed: number };
export type Verify = ReturnType<typeof createPaymentAdapter>['verifyPayment'];
export type UnpaidOrder = { id: string; status: string; data: string; total: number; checkout_ref: string; created: number; payment_ref?: string | null; notification_id?: string | null };

/** How long an unpaid checkout may hold stock before it is verified and released. */
export const UNPAID_HOLD_MS = 24 * 3600000;
/**
 * While the recovery mailer is enabled it owns an unpaid checkout for its first week: it waits a
 * day, offers the customer a further discount, and points them back at that same order to pay it.
 * Cancelling underneath that would send people a discount on an order we had just destroyed, so a
 * recovery-eligible checkout is left alone until the programme has finished with it. With recovery
 * switched off there is nothing to wait for and the day-long hold is the whole of it.
 */
export const RECOVERY_WINDOW_MS = 7 * RECOVERY_DAY;
/** Statuses a release may act on. 'review' is deliberately absent: a person owns that order. */
export const RELEASABLE = ['creating', 'awaiting_payment', 'pending'];
export const HEALTH_KEY = 'checkout_expiry_health_v1';

const json = (value: string): any => { try { return JSON.parse(value); } catch { return null; } };

/**
 * Cancel one unpaid checkout and give its stock back, but only when the provider confirms that no
 * payment exists for it. Returns true only when this call is the one that released the order.
 *
 * Both writes are guarded on the exact row that was read, so a payment landing, an administrator
 * edit or a second release running concurrently makes this do nothing at all rather than cancel an
 * order somebody just paid for.
 */
export async function releaseUnpaidOrder(db: D1Database, verify: Verify, order: UnpaidOrder, now: number): Promise<boolean> {
    const saved = json(order.data);
    if (!saved || !RELEASABLE.includes(order.status) || order.payment_ref || order.notification_id) return false;
    // An archived product is a review case, not an expiry case.
    if (unavailableOrder(saved)) return false;
    const verification = await verify({ id: order.id, totalCents: order.total, currency: 'USD' }, order.checkout_ref, [], order.created);
    if (!verification.noPaymentFound || verification.state !== 'pending') return false;
    const released = JSON.stringify({ ...saved, releasedAt: now, releasedReason: 'unpaid_checkout_expired' });
    const result = await db.batch([
        db.prepare("UPDATE orders SET status='cancelled',data=?,updated=? WHERE id=? AND status=? AND total=? AND data=? AND payment_ref IS NULL AND notification_id IS NULL")
            .bind(released, now, order.id, order.status, order.total, order.data),
        // Only ever deletes the reservations of an order this batch just cancelled.
        db.prepare("DELETE FROM inventory_reservations WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelled')")
            .bind(order.id, order.id),
    ]);
    return Boolean(result[0]?.meta?.changes);
}

/** Unpaid checkouts past the hold window, oldest first, in this payment environment. */
const DUE = `SELECT id,status,data,total,checkout_ref,created,payment_ref,notification_id FROM orders
    WHERE status IN ('creating','awaiting_payment','pending')
        AND payment_ref IS NULL AND notification_id IS NULL
        AND created <= ?
    ORDER BY created LIMIT ?`;

export async function readCheckoutExpiryHealth(env: ExpiryEnvironment): Promise<ExpiryHealth | null> {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(HEALTH_KEY).first<{ value: string }>();
    return json(row?.value || 'null');
}

/**
 * Five-minute sweep. Bounded work per run; the oldest silence is always looked at first, so a
 * backlog drains in order instead of starving the orders that have waited longest.
 */
export async function runCheckoutExpiry(env: ExpiryEnvironment, deps: { now?: () => number; verify?: Verify } = {}): Promise<ExpiryHealth> {
    const now = (deps.now || Date.now)();
    const counters = { due: 0, released: 0, kept: 0, failed: 0 };
    const write = async (status: string) => {
        const health: ExpiryHealth = { status, checkedAt: now, ...counters };
        try { await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(HEALTH_KEY, JSON.stringify(health)).run(); } catch { }
        return health;
    };
    let recovering = false;
    try {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key='checkout_recovery_v1'").first<{ value: string }>();
        recovering = json(row?.value || 'null')?.enabled === true;
    } catch { return write('settings_unreadable'); }
    // A checkout the recovery mailer may still act on is not due yet, however old it is.
    const due = now - (recovering ? RECOVERY_WINDOW_MS : UNPAID_HOLD_MS);
    let rows: UnpaidOrder[];
    try { rows = (await env.DB.prepare(DUE).bind(due, 10).all<UnpaidOrder>()).results; }
    catch { return write('queue_unreadable'); }
    counters.due = rows.length;
    if (!rows.length) return write('completed');
    const verify = deps.verify || createPaymentAdapter(env).verifyPayment;
    const environment = paymentEnvironment(env);
    for (const order of rows) {
        // An order from another payment environment is never ours to cancel.
        if (json(order.data)?.environment !== environment) { counters.kept += 1; continue; }
        try { if (await releaseUnpaidOrder(env.DB, verify, order, now)) counters.released += 1; else counters.kept += 1; }
        catch { counters.failed += 1; }
    }
    return write('completed');
}
