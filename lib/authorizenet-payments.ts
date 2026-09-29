import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
// Authorize.net Accept Hosted adapter. Card data is entered only on Authorize.net's hosted page;
// this server never receives card numbers. Only authenticated Authorize.net API reads mark an order paid.
type Environment = Record<string, string | undefined>;
export type AnetOrder = {
    id: string;
    totalCents: number;
    currency: 'USD';
};
export type AnetCustomer = {
    email?: string;
    customerId?: string;
    name?: string;
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
};
export type AnetPaymentStatus = {
    provider: 'Authorize.net';
    gateway: 'Accept Hosted';
    state: 'not_configured' | 'sandbox' | 'live';
    checkoutEnabled: boolean;
    message: string;
    missing: string[];
};
export type AnetVerification = {
    state: 'paid' | 'pending' | 'failed' | 'review';
    providerReference: string | null;
    notificationId?: string;
    /** A transaction exists but Authorize.net is holding it for fraud review. */
    underReview?: boolean;
    message: string;
};
export class AnetPaymentError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'AnetPaymentError';
    }
}
export const ANET_API = {
    sandbox: 'https://apitest.authorize.net/xml/v1/request.api',
    live: 'https://api.authorize.net/xml/v1/request.api',
} as const;
export const ANET_HOSTED_FORM = {
    sandbox: 'https://test.authorize.net/payment/payment',
    live: 'https://accept.authorize.net/payment/payment',
} as const;
// Statuses documented for getTransactionDetails.
const PAID = new Set(['capturedPendingSettlement', 'settledSuccessfully']);
const PENDING = new Set(['FDSPendingReview', 'FDSAuthorizedPendingReview', 'underReview', 'authorizedPendingRelease']);
const FAILED = new Set(['declined', 'voided', 'expired', 'generalError', 'failedReview', 'communicationError', 'settlementError', 'couldNotVoid']);
const LIST_LIMIT = 1000;
function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
function httpsUrl(value: string | undefined): URL | null {
    try {
        const url = new URL(value || '');
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || url.search)
            return null;
        return url;
    }
    catch {
        return null;
    }
}
function configuration(env: Environment) {
    const missing: string[] = [];
    const environment = env.AUTHORIZENET_ENVIRONMENT;
    if (environment !== 'sandbox' && environment !== 'live')
        missing.push('Authorize.net environment');
    const loginId = (env.AUTHORIZENET_API_LOGIN_ID || '').trim();
    const transactionKey = (env.AUTHORIZENET_TRANSACTION_KEY || '').trim();
    const signatureKey = (env.AUTHORIZENET_SIGNATURE_KEY || '').trim();
    if (!/^[A-Za-z0-9]{1,25}$/.test(loginId))
        missing.push('Authorize.net API login ID');
    if (!/^[A-Za-z0-9]{16}$/.test(transactionKey))
        missing.push('Authorize.net transaction key');
    if (!/^[A-Fa-f0-9]{128}$/.test(signatureKey))
        missing.push('Authorize.net signature key');
    const returnUrl = httpsUrl(env.AUTHORIZENET_RETURN_URL);
    if (!returnUrl)
        missing.push('payment return URL');
    const configured = missing.length === 0;
    const verified = env.AUTHORIZENET_CONNECTION_VERIFIED === 'true';
    const modeMatches = (environment === 'live' && env.COMMERCE_MODE === 'live') ||
        (environment === 'sandbox' && env.COMMERCE_MODE === 'sandbox');
    const fulfillmentVerified = environment !== 'live' || env.COMMERCE_FULFILLMENT_VERIFIED === 'true';
    const checkoutEnabled = configured && verified && modeMatches && fulfillmentVerified;
    const status: AnetPaymentStatus = {
        provider: 'Authorize.net',
        gateway: 'Accept Hosted',
        state: configured && (environment === 'sandbox' || environment === 'live') ? environment : 'not_configured',
        checkoutEnabled,
        message: !configured
            ? 'Authorize.net connection is pending merchant setup.'
            : !verified
                ? 'Authorize.net credentials are configured. Connection testing is pending.'
                : !modeMatches
                    ? 'Authorize.net is configured. Checkout is disabled in this site environment.'
                    : !fulfillmentVerified
                        ? 'Authorize.net is configured. Delivery, shipping and tax setup must be verified before accepting orders.'
                        : environment === 'sandbox'
                            ? 'Authorize.net sandbox checkout is enabled. Test transactions only.'
                            : 'Authorize.net checkout is enabled for this merchant configuration.',
        missing: [
            ...missing,
            ...(!verified ? ['verified Authorize.net connection'] : []),
            ...(!fulfillmentVerified ? ['verified fulfillment, shipping and tax setup'] : []),
        ],
    };
    return { status, environment, loginId, transactionKey, signatureKey, returnUrl };
}
export function getAnetPaymentStatus(env: Environment = process.env): AnetPaymentStatus {
    return configuration(env).status;
}
export function validateAnetOrder(order: AnetOrder): void {
    if (!order ||
        typeof order.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(order.id) ||
        order.currency !== 'USD' ||
        !Number.isSafeInteger(order.totalCents) ||
        order.totalCents < 1 ||
        order.totalCents > 99999999) {
        throw new AnetPaymentError('INVALID_ORDER', 'Checkout requires a valid saved USD order and integer total.');
    }
}
// Authorize.net invoiceNumber and refId are limited to 20 characters. Keep this mapping stable across retries.
export function anetOrderReference(id: string): string {
    return createHash('sha256').update('biomod:authorizenet:order:' + id).digest('hex').slice(0, 20).toUpperCase();
}
export function centsToAmount(cents: number): string {
    return (cents / 100).toFixed(2);
}
export function amountToCents(value: unknown): number | null {
    const text = typeof value === 'number' ? value.toFixed(2) : typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
    if (!match)
        return null;
    return Number(match[1]) * 100 + Number((match[2] || '0').padEnd(2, '0'));
}
function clip(value: string | undefined, max: number): string | undefined {
    const text = (value || '').replace(/[<>&"]/g, '').trim();
    return text ? text.slice(0, max) : undefined;
}
// Element order matters: Authorize.net's JSON API is validated against its XML schema sequence.
export function anetHostedPaymentPayload(auth: { name: string; transactionKey: string }, order: AnetOrder, returnUrl: string, customer: AnetCustomer = {}) {
    validateAnetOrder(order);
    const reference = anetOrderReference(order.id);
    const [firstName, ...rest] = (customer.name || '').trim().split(/\s+/);
    const shipTo = customer.line1 ? {
        firstName: clip(firstName, 50),
        lastName: clip(rest.join(' '), 50),
        address: clip(customer.line1, 60),
        city: clip(customer.city, 40),
        state: clip(customer.state, 40),
        zip: clip(customer.zip, 20),
        country: 'US',
    } : undefined;
    const transactionRequest: Record<string, unknown> = {
        transactionType: 'authCaptureTransaction',
        amount: centsToAmount(order.totalCents),
        order: { invoiceNumber: reference, description: 'Biomod order ' + order.id.slice(0, 8) },
    };
    if (customer.email || customer.customerId)
        transactionRequest.customer = {
            ...(customer.customerId ? { id: clip(customer.customerId.replace(/[^A-Za-z0-9]/g, ''), 20) } : {}),
            ...(customer.email ? { email: clip(customer.email, 255) } : {}),
        };
    if (shipTo)
        transactionRequest.shipTo = shipTo;
    // Reject a second identical card charge for the same invoice and amount for eight hours.
    transactionRequest.transactionSettings = { setting: [{ settingName: 'duplicateWindow', settingValue: '28800' }] };
    const setting = (settingName: string, value: unknown) => ({ settingName, settingValue: JSON.stringify(value) });
    return {
        getHostedPaymentPageRequest: {
            merchantAuthentication: auth,
            refId: reference,
            transactionRequest,
            hostedPaymentSettings: {
                setting: [
                    setting('hostedPaymentReturnOptions', { showReceipt: false, url: returnUrl, urlText: 'Return to Biomod', cancelUrl: returnUrl, cancelUrlText: 'Cancel' }),
                    setting('hostedPaymentButtonOptions', { text: 'Pay' }),
                    setting('hostedPaymentOrderOptions', { show: true, merchantName: 'Biomod' }),
                    setting('hostedPaymentPaymentOptions', { cardCodeRequired: true, showCreditCard: true, showBankAccount: false }),
                    setting('hostedPaymentBillingAddressOptions', { show: true, required: true }),
                    setting('hostedPaymentShippingAddressOptions', { show: false, required: false }),
                    setting('hostedPaymentSecurityOptions', { captcha: false }),
                    setting('hostedPaymentCustomerOptions', { showEmail: true, requiredEmail: false, addPaymentProfile: false }),
                ],
            },
        },
    };
}
/** Classify one transaction read from getTransactionDetails. Only call with authenticated API data. */
export function classifyAnetTransaction(order: AnetOrder, raw: unknown): { state: 'paid' | 'pending' | 'failed' | 'review' | 'ignore'; transId: string | null } {
    const t = object(raw);
    const transId = typeof t?.transId === 'string' && /^\d{1,20}$/.test(t.transId) ? t.transId : null;
    if (!t || !transId)
        return { state: 'review', transId: null };
    if (object(t.order)?.invoiceNumber !== anetOrderReference(order.id))
        return { state: 'ignore', transId };
    const status = String(t.transactionStatus || '');
    // Refunds, voids of other types, or auth-only transactions for this invoice need a person to look.
    if (t.transactionType !== 'authCaptureTransaction')
        return { state: 'review', transId };
    if (PAID.has(status)) {
        const amount = amountToCents(t.settleAmount ?? t.authAmount);
        if (String(t.responseCode) !== '1' || amount !== order.totalCents)
            return { state: 'review', transId };
        return { state: 'paid', transId };
    }
    if (PENDING.has(status))
        return { state: 'pending', transId };
    if (FAILED.has(status))
        return { state: 'failed', transId };
    return { state: 'review', transId };
}
export function reconcileAnetTransactions(order: AnetOrder, transactions: unknown[], providerReference: string | null): AnetVerification {
    validateAnetOrder(order);
    const reference = anetOrderReference(order.id);
    if (providerReference !== reference && !(providerReference && /^\d{1,20}$/.test(providerReference)))
        return { state: 'review', providerReference, message: 'The saved checkout reference requires review.' };
    const paid = new Set<string>();
    let pending = false, failed = false, review = false;
    for (const raw of transactions) {
        const result = classifyAnetTransaction(order, raw);
        if (result.state === 'paid' && result.transId) paid.add(result.transId);
        else if (result.state === 'pending') pending = true;
        else if (result.state === 'failed') failed = true;
        else if (result.state === 'review') review = true;
    }
    if (review || paid.size > 1)
        return { state: 'review', providerReference, message: 'Authorize.net returned payment details that require reconciliation.' };
    if (paid.size === 1) {
        const transId = [...paid][0];
        return { state: 'paid', providerReference: transId, notificationId: 'anet:' + transId, message: 'Authorize.net confirmed authorization and capture for this order amount.' };
    }
    if (pending || !failed)
        return { state: 'pending', providerReference, underReview: pending, message: pending ? 'Authorize.net is reviewing this payment.' : 'Payment confirmation is pending from Authorize.net.' };
    return { state: 'failed', providerReference, message: 'Authorize.net reported an unsuccessful payment attempt.' };
}
/** Verify the X-ANET-Signature header (HMAC-SHA512 of the raw body using the Signature Key). */
export function verifyAnetWebhookSignature(rawBody: string, header: string | null, signatureKey: string): boolean {
    const match = /^sha512=([A-Fa-f0-9]{128})$/.exec((header || '').trim());
    if (!match || !/^[A-Fa-f0-9]{128}$/.test(signatureKey))
        return false;
    const expected = createHmac('sha512', signatureKey).update(rawBody, 'utf8').digest();
    const received = Buffer.from(match[1], 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
}
/** Factory injection is for isolated tests. */
export function createAnetAdapter(env: Environment = process.env, request: typeof fetch = fetch) {
    const config = configuration(env);
    function active(requireEnabled: boolean) {
        if (config.status.state === 'not_configured' || (config.environment !== 'sandbox' && config.environment !== 'live') || (requireEnabled && !config.status.checkoutEnabled))
            throw new AnetPaymentError('NOT_CONFIGURED', config.status.message);
        return { ...config, environment: config.environment as 'sandbox' | 'live' };
    }
    const auth = () => ({ name: config.loginId, transactionKey: config.transactionKey });
    async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const { environment } = active(false);
        let response: Response;
        try {
            response = await request(ANET_API[environment], {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                redirect: 'error',
                cache: 'no-store',
                signal: AbortSignal.timeout(15000),
            });
        }
        catch {
            throw new AnetPaymentError('PROVIDER_UNAVAILABLE', 'Authorize.net could not be reached. Check the saved order before retrying.');
        }
        if (!response.ok)
            throw new AnetPaymentError('PROVIDER_REJECTED', 'Authorize.net could not complete this request.');
        let result: Record<string, unknown> | null = null;
        try {
            // Authorize.net prefixes JSON responses with a byte-order mark.
            result = object(JSON.parse((await response.text()).replace(/^﻿/, '')));
        }
        catch {
            /* Never expose provider bodies. */
        }
        if (!result)
            throw new AnetPaymentError('INVALID_RESPONSE', 'Authorize.net returned an incomplete response.');
        const messages = object(result.messages);
        if (messages?.resultCode !== 'Ok') {
            const first = Array.isArray(messages?.message) ? object(messages!.message[0]) : null;
            // E00040: record not found. Callers treat this as an empty result.
            if (first?.code === 'E00040')
                return { ...result, notFound: true };
            throw new AnetPaymentError('PROVIDER_REJECTED', 'Authorize.net declined the request' + (typeof first?.code === 'string' ? ' (' + first.code + ').' : '.'));
        }
        return result;
    }
    async function transactionDetails(transId: string): Promise<Record<string, unknown> | null> {
        if (!/^\d{1,20}$/.test(transId))
            return null;
        const response = await call({ getTransactionDetailsRequest: { merchantAuthentication: auth(), transId } });
        return response.notFound ? null : object(response.transaction);
    }
    async function listUnsettled(): Promise<Record<string, unknown>[]> {
        const found: Record<string, unknown>[] = [];
        for (let offset = 1; offset <= 5; offset++) {
            const response = await call({ getUnsettledTransactionListRequest: { merchantAuthentication: auth(), sorting: { orderBy: 'submitTimeUTC', orderDescending: true }, paging: { limit: LIST_LIMIT, offset } } });
            const page = Array.isArray(response.transactions) ? response.transactions.map(object).filter(Boolean) as Record<string, unknown>[] : [];
            found.push(...page);
            if (page.length < LIST_LIMIT)
                return found;
        }
        throw new AnetPaymentError('TOO_MANY_RESULTS', 'Authorize.net results require manual reconciliation.');
    }
    async function listSettled(since: Date): Promise<Record<string, unknown>[]> {
        const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const batches = await call({ getSettledBatchListRequest: { merchantAuthentication: auth(), includeStatistics: false, firstSettlementDate: iso(since), lastSettlementDate: iso(new Date()) } });
        const found: Record<string, unknown>[] = [];
        const list = Array.isArray(batches.batchList) ? batches.batchList.map(object).filter(Boolean) as Record<string, unknown>[] : [];
        for (const batch of list.slice(0, 40)) {
            if (typeof batch.batchId !== 'string')
                continue;
            for (let offset = 1; offset <= 5; offset++) {
                const response = await call({ getTransactionListRequest: { merchantAuthentication: auth(), batchId: batch.batchId, sorting: { orderBy: 'submitTimeUTC', orderDescending: true }, paging: { limit: LIST_LIMIT, offset } } });
                const page = Array.isArray(response.transactions) ? response.transactions.map(object).filter(Boolean) as Record<string, unknown>[] : [];
                found.push(...page);
                if (page.length < LIST_LIMIT)
                    break;
            }
        }
        return found;
    }
    return {
        getStatus: () => config.status,
        environment: config.environment,
        reference: anetOrderReference,
        /** Returns our own same-site page that issues a fresh hosted-form token on each visit. */
        async createCheckout(order: AnetOrder, returnUrl: string): Promise<{ url: string; providerReference: string }> {
            validateAnetOrder(order);
            const current = active(true);
            if (!current.returnUrl || returnUrl !== current.returnUrl.href)
                throw new AnetPaymentError('INVALID_RETURN_URL', 'The return URL must match the configured payment return page.');
            return { url: '/api/store/pay?id=' + encodeURIComponent(order.id), providerReference: anetOrderReference(order.id) };
        },
        /** Request a single-use Accept Hosted token (valid 15 minutes). */
        async hostedForm(order: AnetOrder, customer: AnetCustomer = {}): Promise<{ action: string; token: string }> {
            validateAnetOrder(order);
            const current = active(true);
            const response = await call(anetHostedPaymentPayload(auth(), order, current.returnUrl!.href, customer));
            if (typeof response.token !== 'string' || !response.token)
                throw new AnetPaymentError('INVALID_TOKEN', 'Authorize.net did not return a payment form token.');
            return { action: ANET_HOSTED_FORM[current.environment], token: response.token };
        },
        transactionDetails,
        /** Read-only. Uses a transaction ID hint (from a signed webhook) and otherwise searches recent transactions by invoice. */
        async verifyPayment(order: AnetOrder, providerReference: string | null, hints: string[] = [], created = Date.now()): Promise<AnetVerification> {
            validateAnetOrder(order);
            active(false);
            const reference = anetOrderReference(order.id);
            const ids = new Set<string>(hints.filter(h => /^\d{1,20}$/.test(h)));
            if (providerReference && /^\d{1,20}$/.test(providerReference))
                ids.add(providerReference);
            const matches = (t: Record<string, unknown>) => t.invoiceNumber === reference || object(t.order)?.invoiceNumber === reference;
            for (const t of await listUnsettled())
                if (matches(t) && typeof t.transId === 'string') ids.add(t.transId);
            const settledSince = new Date(Math.max(created - 86400000, Date.now() - 30 * 86400000));
            if (Date.now() - created > 3600000)
                for (const t of await listSettled(settledSince))
                    if (matches(t) && typeof t.transId === 'string') ids.add(t.transId);
            if (ids.size > 20)
                return { state: 'review', providerReference, message: 'Authorize.net results require manual reconciliation.' };
            const details: unknown[] = [];
            for (const id of ids) {
                const d = await transactionDetails(id);
                if (d) details.push(d);
            }
            return reconcileAnetTransactions(order, details, providerReference);
        },
    };
}
