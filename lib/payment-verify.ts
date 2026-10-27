// Automatic payment verification (owner, Oct 27 2026): "verify that the payment was captured properly".
//
// An order reaching `paid` means a transaction was accepted during checkout. This job asks the
// provider again, afterwards, and insists on something narrower: a transaction on this order's own
// invoice, of type auth-and-capture, approved by the bank, for this order's exact total, not voided
// and not reversed. That is the question the green check in the Orders queue answers.
//
// It is deliberately a second opinion rather than a repeat of checkout. Checkout verifies under time
// pressure, with the customer waiting and one provider call to go on. This runs later, as often as it
// needs to, and keeps asking a captured payment until the money has actually settled.
//
// Nothing here ever changes an order's status, buys anything or emails a customer. It writes one
// field and, at most once per order, tells the owner that a payment did not hold up.
import { createPaymentAdapter, paymentEnvironment } from './payments';
import { paymentAttempt, savedPaymentVerification, type PaymentVerification } from './payment-check';
import { sendTelegramText } from './telegram';

export type PaymentVerifyEnvironment = { DB: D1Database } & Record<string, any>;
export type PaymentVerifyHealth = {
    checkedAt: number;
    /** Orders due, and what the provider said about them. */
    due: number; settled: number; captured: number; failed: number;
    /** Orders whose provider could not be reached. No verdict is recorded for these. */
    unreachable: number;
    /** Orders skipped because they belong to another payment environment. */
    foreign: number;
    alerted: number;
};

const HOUR = 3600000;
const DAY = 86400000;
/** A captured payment settles overnight, so asking again every few hours is enough. */
export const RECHECK_MS = 6 * HOUR;
/** Older than this and a payment is the accountant's problem, not a scheduled job's. */
export const HORIZON_MS = 60 * DAY;
const PER_RUN = 8;
const HEALTH_KEY = 'payment_verify_health_v1';

/**
 * Due for another look: paid, not a test, recent enough, and either never verified or verified as
 * something other than settled. A settled payment is finished — the money is in the account and no
 * later question can change that, so it is never asked about again.
 */
const DUE = `SELECT id,total,status,data,created,checkout_ref FROM orders
    WHERE status IN ('paid','labeling','shipped','delivered')
      AND json_extract(data,'$.internalTest') IS NULL
      AND created > ?
      AND coalesce(json_extract(data,'$.paymentVerified.state'),'') <> 'settled'
      AND coalesce(json_extract(data,'$.paymentVerified.at'),0) < ?
    ORDER BY created DESC LIMIT ?`;
/**
 * Only this one field moves, and `updated` deliberately does not: that column is the grace period
 * automatic label purchase measures from, so a verification must never postpone a parcel.
 */
const SAVE = `UPDATE orders SET data=json_set(data,'$.paymentVerified',json(?)) WHERE id=?`;

type DueRow = { id: string; total: number; status: string; data: string; created: number; checkout_ref: string | null };

/** The provider's answer about an order already marked paid, reduced to a verdict. */
export function verdictFor(result: { state: string; providerReference?: string | null; noPaymentFound?: boolean; underReview?: boolean; message?: string; transactions?: unknown[] }): Omit<PaymentVerification, 'at'> {
    const transId = String(result.providerReference || '');
    if (result.state === 'paid') {
        const attempts = (result.transactions || []).map(paymentAttempt).filter(Boolean);
        const matched = attempts.find(a => a!.transId === transId) || attempts[0] || null;
        const settled = matched?.status === 'settledSuccessfully';
        return {
            state: settled ? 'settled' : 'captured',
            transId,
            amountCents: matched?.amountCents ?? null,
            why: settled ? 'Settled at the provider for the order total.' : 'Collected for the order total, settling overnight.',
        };
    }
    // Everything below is a paid order the provider will not stand behind, which is the whole point
    // of asking twice. Each one is said plainly, because the owner has to act on it.
    const why = result.noPaymentFound
        ? 'This order is marked paid, but the provider has no payment for it.'
        : result.underReview
            ? 'The provider is holding this payment for review, so the money is not collected.'
            : result.state === 'failed'
                ? 'The provider reports an unsuccessful payment for this order.'
                : String(result.message || 'The provider could not confirm this payment.');
    return { state: 'failed', transId, amountCents: null, why };
}

/** One message, once, naming the order and what is wrong with the money. */
const alertText = (id: string, why: string) => [
    'Payment problem on order #' + id.slice(0, 8).toUpperCase(),
    why,
    'This order is marked paid. Check it at the provider before shipping.',
    'https://trybiomod.com/admin?tab=orders',
].join('\n');

const saveHealth = async (env: PaymentVerifyEnvironment, health: PaymentVerifyHealth, status: string) => {
    try { await env.DB.prepare(`INSERT INTO settings(key,value) VALUES('${HEALTH_KEY}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify({ ...health, status })).run(); }
    catch { /* health is a report, never the thing that fails a run */ }
};
/** What the last run saw. Never throws: a missing report is not an outage. */
export async function readPaymentVerifyHealth(env: PaymentVerifyEnvironment): Promise<(PaymentVerifyHealth & { status: string }) | null> {
    try {
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='${HEALTH_KEY}'`).first<{ value: string }>();
        return row?.value ? JSON.parse(row.value) : null;
    } catch { return null; }
}

export async function runPaymentVerification(env: PaymentVerifyEnvironment, now = Date.now(), deps: { fetch?: typeof fetch } = {}): Promise<PaymentVerifyHealth> {
    const health: PaymentVerifyHealth = { checkedAt: now, due: 0, settled: 0, captured: 0, failed: 0, unreachable: 0, foreign: 0, alerted: 0 };
    let due: DueRow[] = [];
    try { due = (await env.DB.prepare(DUE).bind(now - HORIZON_MS, now - RECHECK_MS, PER_RUN).all<DueRow>()).results || []; }
    catch { await saveHealth(env, health, 'queue_unreadable'); return health; }
    health.due = due.length;
    if (!due.length) { await saveHealth(env, health, 'nothing_due'); return health; }

    const environment = paymentEnvironment(env as Record<string, string | undefined>);
    let adapter;
    try { adapter = createPaymentAdapter(env as Record<string, string | undefined>); }
    catch { await saveHealth(env, health, 'provider_unconfigured'); return health; }

    for (const row of due) {
        let data: Record<string, any> = {};
        try { data = JSON.parse(row.data); } catch { data = {}; }
        // An order is only ever asked about at the provider and environment that created it. Checking
        // a live order against sandbox credentials would answer the wrong question convincingly.
        if (data.environment !== environment) { health.foreign += 1; continue; }

        let result;
        try { result = await adapter.verifyPayment({ id: row.id, totalCents: row.total, currency: 'USD' }, row.checkout_ref, [], row.created); }
        catch {
            // The provider being unreachable says nothing about the money. Record no verdict at all:
            // a wrong red flag on a good payment is worse than asking again in a few hours.
            health.unreachable += 1;
            continue;
        }
        const verdict = verdictFor(result);
        const previous = savedPaymentVerification(data.paymentVerified);
        // The owner is told once per order. A payment that keeps failing is the same news each time.
        const alreadyTold = Number.isFinite(previous?.alertedAt);
        const tell = verdict.state === 'failed' && !alreadyTold;
        let alertedAt = previous?.alertedAt;
        if (tell) {
            try {
                if (await sendTelegramText(env as never, alertText(row.id, verdict.why), deps)) { alertedAt = now; health.alerted += 1; }
            } catch { /* an unreachable chat must not stop the verdict being recorded */ }
        }
        const record: PaymentVerification = { at: now, ...verdict, ...(Number.isFinite(alertedAt) ? { alertedAt: alertedAt as number } : {}) };
        try { await env.DB.prepare(SAVE).bind(JSON.stringify(record), row.id).run(); }
        catch { continue; }
        health[verdict.state === 'settled' ? 'settled' : verdict.state === 'captured' ? 'captured' : 'failed'] += 1;
    }
    await saveHealth(env, health, 'completed');
    return health;
}
