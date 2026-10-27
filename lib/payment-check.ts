// What Authorize.net said about an order's payment attempts, in plain words, saved on the order
// when it is checked so the Orders screen can explain a "Needs review" row without a live call.
// Owner, Oct 23 2026: "this screen does not give enough information" after his own test purchase
// sat in Needs review with no reason given. Authorize.net had authorized it and held it for review.
// Only masked card digits are kept (Authorize.net returns XXXX1234). No IP, no full card data.

export type PaymentAttempt = {
    transId: string;
    /** Authorize.net's own status name, e.g. FDSPendingReview. */
    status: string;
    /** held | declined | paid | refunded | other */
    kind: 'held' | 'declined' | 'paid' | 'refunded' | 'other';
    words: string;
    submittedAt: number | null;
    amountCents: number | null;
    card: string;
    /** Bank answer, e.g. "This transaction has been approved." */
    reason: string;
    avs: string;
    cvv: string;
    /** Fraud filters that flagged it, with what each did. */
    filters: { name: string; action: string }[];
};
export type PaymentCheck = {
    at: number;
    attempts: PaymentAttempt[];
    /** When an unanswered hold lapses: Authorize.net expires held transactions after 5 days. */
    holdExpiresAt: number | null;
};

const HOLD_DAYS = 5;
const HELD = new Set(['FDSPendingReview', 'FDSAuthorizedPendingReview', 'underReview', 'authorizedPendingRelease']);
const DECLINED = new Set(['declined', 'failedReview', 'generalError', 'communicationError', 'expired', 'voided', 'couldNotVoid', 'settlementError']);
const PAID = new Set(['capturedPendingSettlement', 'settledSuccessfully']);

const statusWords: Record<string, string> = {
    FDSPendingReview: 'Held by your fraud filter before the card was charged',
    FDSAuthorizedPendingReview: 'Card approved, then held by your fraud filter. Not collected until you approve it',
    underReview: 'Held for review by Authorize.net',
    authorizedPendingRelease: 'Card approved, waiting for you to release it',
    declined: 'Card declined',
    failedReview: 'Declined after review',
    voided: 'Voided',
    expired: 'Hold expired without approval. The money was never collected',
    generalError: 'Payment error at Authorize.net',
    communicationError: 'Payment error: the bank could not be reached',
    settlementError: 'Settlement error',
    couldNotVoid: 'Could not be voided',
    capturedPendingSettlement: 'Paid. Settles tonight',
    settledSuccessfully: 'Paid and settled',
    refundSettledSuccessfully: 'Refund settled',
    refundPendingSettlement: 'Refund pending',
};

// Authorize.net AVS codes (address check).
const avsWords: Record<string, string> = {
    A: 'Street matches, ZIP does not', B: 'Address not provided', E: 'Address check error', G: 'Card from outside the US: no address check',
    N: 'Neither street nor ZIP match', P: 'Address check not applicable', R: 'Address check unavailable, retry', S: 'Card bank does not support address check',
    U: 'Address information unavailable', W: '9-digit ZIP matches, street does not', X: 'Street and 9-digit ZIP match', Y: 'Street and ZIP match',
    Z: 'ZIP matches, street does not',
};
// Card code (CVV) results.
const cvvWords: Record<string, string> = { M: 'Security code matches', N: 'Security code does not match', P: 'Security code not processed', S: 'Security code should have been present', U: 'Card bank does not check security codes' };

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
const cents = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const when = (v: unknown) => { const t = Date.parse(text(v, 40)); return Number.isFinite(t) ? t : null; };

function kindOf(status: string, type: string): PaymentAttempt['kind'] {
    if (type && type !== 'authCaptureTransaction' && /refund/i.test(type + status)) return 'refunded';
    if (HELD.has(status)) return 'held';
    if (DECLINED.has(status)) return 'declined';
    if (PAID.has(status)) return 'paid';
    return 'other';
}

/** One getTransactionDetails result, reduced to what staff need to decide. */
export function paymentAttempt(raw: unknown): PaymentAttempt | null {
    const t = obj(raw);
    const transId = text(t?.transId, 20);
    if (!t || !/^\d{1,20}$/.test(transId)) return null;
    const status = text(t.transactionStatus, 60);
    const card = obj(obj(t.payment)?.creditCard);
    const digits = text(card?.cardNumber, 30).replace(/[^0-9]/g, '').slice(-4);
    const fds = Array.isArray(t.FDSFilters) ? t.FDSFilters : Array.isArray(obj(t.FDSFilters)?.FDSFilter) ? obj(t.FDSFilters)!.FDSFilter as unknown[] : [];
    const avsCode = text(t.AVSResponse, 2).toUpperCase();
    const cvvCode = text(t.cardCodeResponse, 2).toUpperCase();
    return {
        transId,
        status,
        kind: kindOf(status, text(t.transactionType, 60)),
        words: statusWords[status] || (status ? status.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Status not reported'),
        submittedAt: when(t.submitTimeUTC),
        amountCents: cents(t.settleAmount ?? t.authAmount),
        card: [text(card?.cardType, 30), digits ? 'ending ' + digits : ''].filter(Boolean).join(' '),
        reason: text(t.responseReasonDescription, 200),
        avs: avsCode ? (avsWords[avsCode] || 'Address check ' + avsCode) : '',
        cvv: cvvCode ? (cvvWords[cvvCode] || 'Security code check ' + cvvCode) : '',
        filters: fds.map(obj).filter(Boolean).map(f => ({ name: text(f!.name, 100), action: text(f!.action, 60) })).filter(f => f.name).slice(0, 10),
    };
}

export function paymentCheck(transactions: unknown[], at = Date.now()): PaymentCheck {
    const attempts = transactions.map(paymentAttempt).filter((a): a is PaymentAttempt => Boolean(a))
        .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, 10);
    const held = attempts.filter(a => a.kind === 'held' && a.submittedAt).map(a => a.submittedAt as number);
    return { at, attempts, holdExpiresAt: held.length ? Math.min(...held) + HOLD_DAYS * 86400000 : null };
}

/** Reads a saved check back off order data; anything malformed reads as no check. */
export function savedPaymentCheck(value: unknown): PaymentCheck | null {
    const v = obj(value);
    if (!v || !Number.isFinite(v.at) || !Array.isArray(v.attempts)) return null;
    return { at: v.at as number, attempts: v.attempts as PaymentAttempt[], holdExpiresAt: Number.isFinite(v.holdExpiresAt) ? v.holdExpiresAt as number : null };
}

const filterNames = (a: PaymentAttempt) => a.filters.map(f => f.name).join(', ');
const day = (at: number) => new Date(at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) + ' PT';

/** One line for the Orders table: what happened to the money, and what to do. */
export function paymentLine(check: PaymentCheck | null, now = Date.now()): string {
    if (!check) return '';
    const latest = check.attempts[0];
    if (!latest) return 'No card payment at Authorize.net yet (checked ' + day(check.at) + ')';
    const tries = check.attempts.length > 1 ? ' · ' + check.attempts.length + ' card attempts' : '';
    if (latest.kind === 'held') {
        const filters = filterNames(latest);
        const due = check.holdExpiresAt ? (check.holdExpiresAt > now ? ' · Approve in Authorize.net by ' + day(check.holdExpiresAt) : ' · Hold has probably expired') : '';
        return 'Card approved, held by fraud filter' + (filters ? ': ' + filters : '') + due + tries;
    }
    if (latest.kind === 'declined') return latest.words + (latest.reason ? ': ' + latest.reason : '') + tries;
    return latest.words + tries;
}

/** What the owner does next, for the order panel. */
export function paymentAdvice(check: PaymentCheck | null, now = Date.now()): string {
    const latest = check?.attempts[0];
    if (!check || !latest) return '';
    if (latest.kind === 'held') return 'The customer\'s card approved this payment, but your Authorize.net fraud filter is holding it, so the money is not collected yet. In Authorize.net, open Tools > Fraud Detection Suite > Suspicious Transaction Reports (or Transaction Search > Unsettled), find transaction ' + latest.transId + ', and press Approve (or Decline to release the customer\'s money). Then press Check payment here. ' + (check.holdExpiresAt && check.holdExpiresAt > now ? 'If nobody answers, the hold expires ' + day(check.holdExpiresAt) + ' and the sale is lost.' : '');
    if (latest.kind === 'declined') return 'The card did not go through, so no money was taken. The customer can try another card from their order page; you may want to email them.';
    if (latest.kind === 'paid') return 'Authorize.net shows this payment collected. Press Check payment to move the order to To ship.';
    return 'Check this transaction in Authorize.net before shipping.';
}

/**
 * The result of independently re-asking the provider about an order that is already marked paid.
 *
 * `paid` on an order means a transaction was accepted at checkout. This says something narrower and
 * later: we went back to the provider, found the transaction on this order's own invoice, and it is
 * an auth-and-capture for this order's exact total that the bank approved and has not reversed.
 * `settled` means the money reached the merchant account; `captured` means it is collected and
 * settles overnight. Anything else is `failed` and wants a person (owner, Oct 27 2026).
 */
export type PaymentVerification = {
    at: number;
    state: 'settled' | 'captured' | 'failed';
    transId: string;
    amountCents: number | null;
    why: string;
    /** Set once, when the owner was told. A failure never alerts the same order twice. */
    alertedAt?: number;
};

/** Reads a saved verification back off order data; anything malformed reads as not verified. */
export function savedPaymentVerification(value: unknown): PaymentVerification | null {
    const v = obj(value);
    const state = text(v?.state, 20);
    if (!v || !Number.isFinite(v.at) || !['settled', 'captured', 'failed'].includes(state)) return null;
    return {
        at: v.at as number,
        state: state as PaymentVerification['state'],
        transId: text(v.transId, 20),
        amountCents: Number.isFinite(v.amountCents) ? v.amountCents as number : null,
        why: text(v.why, 300),
        ...(Number.isFinite(v.alertedAt) ? { alertedAt: v.alertedAt as number } : {}),
    };
}

/** Only a confirmed collection earns the check. No verification yet is never a pass. */
export const paymentConfirmed = (v: PaymentVerification | null): boolean => v?.state === 'settled' || v?.state === 'captured';

/** What the check means, in the owner's words, for a tooltip or a line of text. */
export function verificationLabel(v: PaymentVerification | null): string {
    if (!v) return '';
    const amount = v.amountCents === null ? '' : ' of $' + (v.amountCents / 100).toFixed(2);
    if (v.state === 'settled') return 'Payment verified: ' + (v.amountCents === null ? 'collected' : 'the full order total' + amount) + ' settled at the provider. Checked ' + day(v.at) + '.';
    if (v.state === 'captured') return 'Payment verified: ' + (v.amountCents === null ? 'collected' : 'the full order total' + amount + ' collected') + ', settling overnight. Checked ' + day(v.at) + '.';
    return 'Payment could not be verified: ' + (v.why || 'the provider did not confirm this payment') + ' (checked ' + day(v.at) + ').';
}
