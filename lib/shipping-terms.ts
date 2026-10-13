import { normalizeShippingOptions, type ShippingOptionsConfig } from './shipping-options';

type ShippingTermsConfig = { freeShippingAt: number; shippingOptions?: Partial<ShippingOptionsConfig> };
const dollars = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
// A missing current configuration is not evidence of a free-shipping offer.
export function shippingTerms(config: ShippingTermsConfig | null | undefined) {
    const options = config ? normalizeShippingOptions(config.shippingOptions) : null;
    const freeThreshold = config && options?.standardEnabled && options.freeStandardEnabled && Number.isSafeInteger(config.freeShippingAt) && config.freeShippingAt >= 0 && config.freeShippingAt <= 1000000 ? config.freeShippingAt : null;
    const standard = freeThreshold === null ? 'Available shipping services and charges are shown at checkout before payment.'
        : freeThreshold === 0 ? 'Standard U.S. shipping is free. Expedited and overnight services are priced separately.'
        : `Standard shipping is free on orders of ${dollars(freeThreshold)} or more after discounts and before tax. Expedited and overnight services are priced separately.`;
    const banner = freeThreshold === null ? 'U.S. shipping · Review available services at checkout.'
        : freeThreshold === 0 ? 'U.S. shipping · Free standard delivery.'
        : `U.S. shipping · Free standard delivery on orders of ${dollars(freeThreshold)} or more.`;
    const overnight = options?.services ? (options.overnightEnabled ? 'Overnight delivery is offered at checkout when a carrier serves your address. The complete shipping charge is shown before payment.' : null)
        : options?.overnightEnabled ? `When available for your address, overnight shipping is the carrier's quoted rate plus a ${dollars(options.overnightHandlingCents)} handling fee. The complete shipping charge is shown before payment.` : null;
    return { freeThreshold, standard, banner, overnight };
}
export const shippingDispatchTerms = 'Carrier delivery estimates start after dispatch, not when the order is placed. Overnight service does not speed up preorder availability or order processing. Weekends, holidays, carrier cutoffs and destination restrictions may affect delivery; an arrival date is not guaranteed by this store.';
