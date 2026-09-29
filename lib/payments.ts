// Payment provider selection. PAYMENT_PROVIDER=authorizenet (default) or chase.
import { createChaseAdapter, chaseOrderReference, getChasePaymentStatus } from './chase-payments';
import { createAnetAdapter, anetOrderReference, getAnetPaymentStatus } from './authorizenet-payments';
type Environment = Record<string, string | undefined>;
export type PaymentOrder = { id: string; totalCents: number; currency: 'USD' };
export type Verification = { state: 'paid' | 'pending' | 'failed' | 'review'; providerReference: string | null; notificationId?: string; message: string };
export type ProviderStatus = { provider: string; state: 'not_configured' | 'sandbox' | 'live'; checkoutEnabled: boolean; message: string; missing: string[] };
export const paymentProvider = (env: Environment): 'authorizenet' | 'chase' => env.PAYMENT_PROVIDER === 'chase' ? 'chase' : 'authorizenet';
/** Saved on each order so an order is only ever verified against the provider and environment that created it. */
export function paymentEnvironment(env: Environment): string | undefined {
    if (paymentProvider(env) === 'chase')
        return env.CHASE_ENVIRONMENT;
    return env.AUTHORIZENET_ENVIRONMENT ? 'authorizenet:' + env.AUTHORIZENET_ENVIRONMENT : undefined;
}
export const paymentReturnUrl = (env: Environment) => paymentProvider(env) === 'chase' ? env.CHASE_RETURN_URL : env.AUTHORIZENET_RETURN_URL;
export function getPaymentStatus(env: Environment): ProviderStatus {
    return paymentProvider(env) === 'chase' ? getChasePaymentStatus(env) : getAnetPaymentStatus(env);
}
export function createPaymentAdapter(env: Environment) {
    if (paymentProvider(env) === 'chase') {
        const chase = createChaseAdapter(env);
        return {
            provider: 'chase' as const,
            getStatus: (): ProviderStatus => chase.getStatus(),
            reference: chaseOrderReference,
            createCheckout: (order: PaymentOrder, returnUrl: string) => chase.createCheckout(order, returnUrl),
            verifyPayment: (order: PaymentOrder, reference: string | null): Promise<Verification> => chase.verifyPayment(order, reference),
        };
    }
    const anet = createAnetAdapter(env);
    return {
        provider: 'authorizenet' as const,
        getStatus: (): ProviderStatus => anet.getStatus(),
        reference: anetOrderReference,
        createCheckout: (order: PaymentOrder, returnUrl: string) => anet.createCheckout(order, returnUrl),
        verifyPayment: (order: PaymentOrder, reference: string | null, hints: string[] = [], created?: number): Promise<Verification> => anet.verifyPayment(order, reference, hints, created),
    };
}
