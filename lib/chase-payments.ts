import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
type Environment = Record<string, string | undefined>;
export type ChaseOrder = {
    id: string;
    totalCents: number;
    currency: 'USD';
};
export type PaymentStatus = {
    provider: 'Chase';
    gateway: 'J.P. Morgan Checkout';
    state: 'not_configured' | 'sandbox' | 'live';
    checkoutEnabled: boolean;
    message: string;
    missing: string[];
};
export type ChaseVerification = {
    state: 'paid' | 'pending' | 'failed' | 'review';
    providerReference: string | null;
    notificationId?: string;
    message: string;
};
export class ChasePaymentError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'ChasePaymentError';
    }
}
// Product-specific Commerce OAuth documentation, not the mock client-secret API.
const TOKEN_URL = 'https://idag2.jpmorganchase.com/adfs/oauth2/token';
const API = {
    sandbox: 'https://merchant-api.checkout-cat.merchant.jpmorgan.com/v1',
    live: 'https://merchant-api.checkout.merchant.jpmorgan.com/v1',
} as const;
const tokenCache = new Map<string, {
    token: string;
    expiresAt: number;
}>();
const tokenRequests = new Map<string, Promise<string>>();
function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
function httpsUrl(value: string | undefined, originOnly = false): URL | null {
    try {
        const url = new URL(value || '');
        if (url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.hash ||
            url.port)
            return null;
        if (originOnly && (url.pathname !== '/' || url.search))
            return null;
        return url;
    }
    catch {
        return null;
    }
}
function configuration(env: Environment) {
    const missing: string[] = [];
    const environment = env.CHASE_ENVIRONMENT;
    if (env.CHASE_GATEWAY !== 'jpmorgan_checkout')
        missing.push('Chase gateway selection');
    if (environment !== 'sandbox' && environment !== 'live')
        missing.push('Chase environment');
    for (const [key, label] of [
        ['CHASE_CLIENT_ID', 'Chase client ID'],
        ['CHASE_RESOURCE_ID', 'Chase resource ID'],
        ['CHASE_MERCHANT_ID', 'Chase merchant ID'],
    ])
        if (!env[key]?.trim())
            missing.push(label);
    const thumbprint = env.CHASE_CERTIFICATE_THUMBPRINT || '';
    if (!/^[A-F0-9]{40}$/.test(thumbprint))
        missing.push('uppercase certificate thumbprint');
    let privateKey: ReturnType<typeof createPrivateKey> | null = null;
    try {
        privateKey = createPrivateKey((env.CHASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'));
        if (privateKey.asymmetricKeyType !== 'rsa' ||
            (privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048)
            privateKey = null;
    }
    catch {
        /* Configuration errors must never echo private key material. */
    }
    if (!privateKey)
        missing.push('RSA private key');
    const hostedOrigin = httpsUrl(env.CHASE_HOSTED_ORIGIN, true);
    if (!hostedOrigin)
        missing.push('Chase-confirmed hosted payment origin');
    const returnUrl = httpsUrl(env.CHASE_RETURN_URL);
    if (!returnUrl || returnUrl.search)
        missing.push('Commerce Center return URL');
    const configured = missing.length === 0;
    const verified = env.CHASE_CONNECTION_VERIFIED === 'true';
    const modeMatches = (environment === 'live' && env.COMMERCE_MODE === 'live') ||
        (environment === 'sandbox' && env.COMMERCE_MODE === 'sandbox');
    const fulfillmentVerified = environment !== 'live' || env.COMMERCE_FULFILLMENT_VERIFIED === 'true';
    const checkoutEnabled = configured && verified && modeMatches && fulfillmentVerified;
    const status: PaymentStatus = {
        provider: 'Chase',
        gateway: 'J.P. Morgan Checkout',
        state: configured && (environment === 'sandbox' || environment === 'live')
            ? environment
            : 'not_configured',
        checkoutEnabled,
        message: !configured
            ? 'Chase connection is pending merchant setup.'
            : !verified
                ? 'Chase credentials are configured. Connection testing and certification are pending.'
                : !modeMatches
                    ? 'Chase is configured. Checkout is disabled in this site environment.'
                    : !fulfillmentVerified
                        ? 'Chase is configured. Delivery, shipping and tax setup must be verified before accepting orders.'
                        : environment === 'sandbox'
                            ? 'Chase sandbox checkout is enabled. Test transactions only.'
                            : 'Chase checkout is enabled for this merchant configuration.',
        missing: [
            ...missing,
            ...(!verified ? ['verified Chase connection'] : []),
            ...(!fulfillmentVerified
                ? ['verified fulfillment, shipping and tax setup']
                : []),
        ],
    };
    return {
        status,
        environment,
        privateKey,
        thumbprint,
        hostedOrigin,
        returnUrl,
        clientId: env.CHASE_CLIENT_ID || '',
        resourceId: env.CHASE_RESOURCE_ID || '',
        segmentId: env.CHASE_SEGMENT_ID,
    };
}
export function getChasePaymentStatus(env: Environment = process.env): PaymentStatus {
    return configuration(env).status;
}
export function validateChaseOrder(order: ChaseOrder): void {
    if (!order ||
        typeof order.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(order.id) ||
        order.currency !== 'USD' ||
        !Number.isSafeInteger(order.totalCents) ||
        order.totalCents < 1 ||
        order.totalCents > 99999999) {
        throw new ChasePaymentError('INVALID_ORDER', 'Checkout requires a valid saved USD order and integer total.');
    }
}
// Both Chase reference fields have a 22-character limit. Retain this mapping on retries.
export function chaseOrderReference(id: string): string {
    return createHash('sha256')
        .update('biomodpro:chase:order:' + id)
        .digest('base64url')
        .slice(0, 22);
}
export function chaseIntentPayload(order: ChaseOrder) {
    validateChaseOrder(order);
    return {
        currencyCode: order.currency,
        merchantOrderNumber: chaseOrderReference(order.id),
        checkoutOptions: {
            authorization: { authorizationType: 'AUTH_METHOD_CART_AMOUNT' },
            capture: { captureMethod: 'CAPTURE_METHOD_NOW' },
        },
        cart: { totalTransactionAmount: order.totalCents },
    };
}
export function validateChaseHostedUrl(value: unknown, allowedOrigin: string): string {
    const origin = httpsUrl(allowedOrigin, true);
    const url = typeof value === 'string' ? httpsUrl(value) : null;
    if (!origin || !url || url.origin !== origin.origin)
        throw new ChasePaymentError('UNSAFE_REDIRECT', 'Chase returned an unexpected hosted checkout address.');
    return url.href;
}
function centsFromNotification(value: unknown): number | null {
    const money = object(value);
    if (!money ||
        money.currencyCode !== 'USD' ||
        typeof money.amount !== 'string' ||
        !/^\d{1,18}$/.test(money.amount) ||
        !Number.isInteger(money.decimalCount) ||
        Number(money.decimalCount) < 0 ||
        Number(money.decimalCount) > 6)
        return null;
    const scaled = BigInt(money.amount) * BigInt(100);
    const divisor = BigInt(10) ** BigInt(Number(money.decimalCount));
    if (scaled % divisor !== BigInt(0))
        return null;
    const amount = Number(scaled / divisor);
    return Number.isSafeInteger(amount) ? amount : null;
}
// Only call with the body received directly from the authenticated Chase API.
// This parser is deliberately not an HTTP callback accepting browser-supplied proof.
export function reconcileChaseNotifications(order: ChaseOrder, messages: unknown[], providerReference: string | null = null): ChaseVerification {
    validateChaseOrder(order);
    const reference = chaseOrderReference(order.id);
    if (providerReference !== reference)
        return { state: 'review', providerReference, message: 'The saved checkout reference requires review.' };
    const successes = new Map<string, ChaseVerification>();
    let failed = false;
    let review = false;
    let pending = false;
    for (const raw of messages) {
        const entry = object(raw);
        const payment = object(entry?.orderNotification);
        if (!entry || !payment)
            continue;
        const merchantOrder = entry.merchantOrderNumber ?? payment.merchantOrderNumber;
        const requestId = entry.requestId ?? payment.requestId;
        if (merchantOrder !== reference || requestId !== reference)
            continue;
        const transaction = typeof payment.transactionReference === 'string' &&
            payment.transactionReference.length > 0
            ? payment.transactionReference
            : null;
        if (payment.status === 'STATUS_PENDING') {
            pending = true;
            continue;
        }
        if (payment.status === 'STATUS_FAILURE') {
            failed = true;
            continue;
        }
        if (payment.status !== 'STATUS_SUCCESS') {
            review = true;
            continue;
        }
        if (payment.checkoutIntent !== 'CHECKOUT_INTENT_AUTH_AND_CAPTURE' ||
            !transaction ||
            centsFromNotification(payment.totalAmount) !== order.totalCents ||
            payment.fraudCheckStatus === 'FRAUD_CHECK_STATUS_DECLINED' ||
            object(payment.fraudCheckResult)?.fraudCheckStatus ===
                'FRAUD_CHECK_STATUS_DECLINED') {
            review = true;
            continue;
        }
        const messageInfo = object(entry.messageInfo);
        const notificationId = typeof messageInfo?.messageId === 'string'
            ? messageInfo.messageId
            : undefined;
        if (!notificationId) {
            review = true;
            continue;
        }
        successes.set(transaction, {
            state: 'paid',
            providerReference: transaction,
            notificationId,
            message: 'Chase confirmed authorization and capture for this order amount.',
        });
    }
    if (review || successes.size > 1)
        return {
            state: 'review',
            providerReference,
            message: 'Chase returned payment details that require reconciliation.',
        };
    if (successes.size === 1)
        return [...successes.values()][0];
    if (pending || !failed)
        return {
            state: 'pending',
            providerReference,
            message: 'Payment confirmation is pending from Chase.',
        };
    return {
        state: 'failed',
        providerReference,
        message: 'Chase reported an unsuccessful payment attempt.',
    };
}
/** Factory injection is for isolated tests. The application uses the exports below. */
export function createChaseAdapter(env: Environment = process.env, request: typeof fetch = fetch) {
    const config = configuration(env);
    function requireConfigured(requireEnabled: boolean) {
        if (config.status.state === 'not_configured' ||
            !config.privateKey ||
            (config.environment !== 'sandbox' && config.environment !== 'live') ||
            (requireEnabled && !config.status.checkoutEnabled)) {
            throw new ChasePaymentError('NOT_CONFIGURED', config.status.message);
        }
        return {
            ...config,
            privateKey: config.privateKey,
            api: API[config.environment],
        };
    }
    async function jsonRequest(url: string, init: RequestInit): Promise<Record<string, unknown>> {
        let response: Response;
        try {
            response = await request(url, {
                ...init,
                redirect: 'error',
                cache: 'no-store',
                signal: AbortSignal.timeout(15000),
            });
        }
        catch {
            throw new ChasePaymentError('PROVIDER_UNAVAILABLE', 'Chase could not be reached. Check the saved order before retrying.');
        }
        if (response.status === 401)
            tokenCache.clear();
        if (!response.ok)
            throw new ChasePaymentError('PROVIDER_REJECTED', 'Chase could not complete this request.');
        try {
            const result = object(await response.json());
            if (result)
                return result;
        }
        catch {
            /* Do not expose provider response bodies or card data. */
        }
        throw new ChasePaymentError('INVALID_RESPONSE', 'Chase returned an incomplete response.');
    }
    async function accessToken(): Promise<string> {
        const credentials = requireConfigured(false);
        const cacheKey = createHash('sha256')
            .update(credentials.clientId +
            ':' +
            credentials.resourceId +
            ':' +
            credentials.thumbprint +
            ':' +
            credentials.environment)
            .digest('hex');
        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() + 60000)
            return cached.token;
        const inFlight = tokenRequests.get(cacheKey);
        if (inFlight)
            return inFlight;
        const pending = (async () => {
            const issued = Math.floor(Date.now() / 1000);
            const header = Buffer.from(JSON.stringify({
                alg: 'RS256',
                typ: 'JWT',
                kid: credentials.thumbprint,
            })).toString('base64url');
            const payload = Buffer.from(JSON.stringify({
                jti: randomUUID(),
                iat: issued,
                exp: issued + 60,
                aud: TOKEN_URL,
                iss: credentials.clientId,
                sub: credentials.clientId,
            })).toString('base64url');
            const signingInput = header + '.' + payload;
            const assertion = signingInput +
                '.' +
                sign('RSA-SHA256', Buffer.from(signingInput), credentials.privateKey).toString('base64url');
            const body = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: credentials.clientId,
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                client_assertion: assertion,
                resource: credentials.resourceId,
            });
            const tokenResponse = await jsonRequest(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            });
            if (typeof tokenResponse.access_token !== 'string' ||
                !tokenResponse.access_token ||
                typeof tokenResponse.token_type !== 'string' ||
                tokenResponse.token_type.toLowerCase() !== 'bearer' ||
                typeof tokenResponse.expires_in !== 'number' ||
                !Number.isFinite(tokenResponse.expires_in) ||
                tokenResponse.expires_in < 120) {
                throw new ChasePaymentError('INVALID_TOKEN', 'Chase authentication did not return a usable token.');
            }
            tokenCache.set(cacheKey, {
                token: tokenResponse.access_token,
                expiresAt: Date.now() + Math.min(tokenResponse.expires_in, 28800) * 1000,
            });
            return tokenResponse.access_token;
        })();
        tokenRequests.set(cacheKey, pending);
        try {
            return await pending;
        }
        finally {
            tokenRequests.delete(cacheKey);
        }
    }
    async function headers() {
        const token = await accessToken();
        return {
            Authorization: 'Bearer ' + token,
            merchantId: env.CHASE_MERCHANT_ID || '',
            ...(config.segmentId ? { segmentId: config.segmentId } : {}),
        };
    }
    return {
        getStatus: () => config.status,
        async createCheckout(order: ChaseOrder, returnUrl: string): Promise<{
            url: string;
            providerReference: string | null;
        }> {
            validateChaseOrder(order);
            const active = requireConfigured(true);
            if (!active.returnUrl || returnUrl !== active.returnUrl.href)
                throw new ChasePaymentError('INVALID_RETURN_URL', 'The return URL must match the configured Commerce Center page.');
            // Never automatically retry this POST: requestId is not a documented idempotency guarantee.
            const response = await jsonRequest(active.api + '/checkout/intent', {
                method: 'POST',
                headers: {
                    ...(await headers()),
                    'Content-Type': 'application/json',
                    requestId: chaseOrderReference(order.id),
                },
                body: JSON.stringify(chaseIntentPayload(order)),
            });
            const url = validateChaseHostedUrl(response.redirectUrl ?? response.checkoutRedirectUrl, active.hostedOrigin!.origin);
            return { url, providerReference: chaseOrderReference(order.id) };
        },
        async verifyPayment(order: ChaseOrder, providerReference: string | null): Promise<ChaseVerification> {
            validateChaseOrder(order);
            const active = requireConfigured(false);
            const now = new Date();
            const query = new URLSearchParams({
                merchantOrderNumber: chaseOrderReference(order.id),
                notificationType: 'NOTIFICATION_TYPE_ORDER',
                periodStart: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString(),
                periodEnd: now.toISOString(),
                pageSize: '100',
            });
            const messages: unknown[] = [];
            const visited = new Set<string>();
            for (let page = 0; page < 10; page++) {
                const response = await jsonRequest(active.api + '/checkout/notifications?' + query.toString(), { method: 'GET', headers: await headers() });
                if (!Array.isArray(response.messages))
                    throw new ChasePaymentError('INVALID_RESPONSE', 'Chase notifications could not be reconciled.');
                messages.push(...response.messages);
                if (!response.nextPageToken)
                    return reconcileChaseNotifications(order, messages, providerReference);
                if (typeof response.nextPageToken !== 'string' ||
                    visited.has(response.nextPageToken))
                    break;
                visited.add(response.nextPageToken);
                query.set('pageToken', response.nextPageToken);
            }
            return {
                state: 'review',
                providerReference,
                message: 'Chase notification results require additional reconciliation.',
            };
        },
    };
}
export async function createChaseCheckout(order: ChaseOrder, returnUrl: string) {
    return createChaseAdapter().createCheckout(order, returnUrl);
}
export async function verifyChasePayment(order: ChaseOrder, providerReference: string | null) {
    return createChaseAdapter().verifyPayment(order, providerReference);
}
