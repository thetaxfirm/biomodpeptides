import { freeShippingService, normalizeShippingOptions, type ShippingOptionsConfig } from './shipping-options';

type ShippingTermsConfig = { freeShippingAt: number; shippingOptions?: Partial<ShippingOptionsConfig> };
const dollars = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
// A missing current configuration is not evidence of a free-shipping offer.
export function shippingTerms(config: ShippingTermsConfig | null | undefined) {
    const options = config ? normalizeShippingOptions(config.shippingOptions) : null;
    const free = options ? freeShippingService(options) : null;
    const freeThreshold = config && free && Number.isSafeInteger(config.freeShippingAt) && config.freeShippingAt >= 0 && config.freeShippingAt <= 1000000 ? config.freeShippingAt : null;
    // Standard keeps its original wording; free USPS Priority Mail names the service and leaves only faster services priced.
    const priority = free?.tier === 'expedited';
    const freeLabel = !free ? null : priority ? free.label : 'standard shipping';
    const others = priority ? 'Faster services are priced separately.' : 'Expedited and overnight services are priced separately.';
    const standard = freeThreshold === null ? 'Available shipping services and charges are shown at checkout before payment.'
        : freeThreshold === 0 ? (priority ? `${free!.label} is free on U.S. orders. ` : 'Standard U.S. shipping is free. ') + others
        : (priority ? `${free!.label} is free` : 'Standard shipping is free') + ` on orders of ${dollars(freeThreshold)} or more after discounts and before tax. ${others}`;
    const banner = freeThreshold === null ? 'U.S. shipping · Review available services at checkout.'
        : freeThreshold === 0 ? (priority ? `U.S. shipping · Free ${free!.label}.` : 'U.S. shipping · Free standard delivery.')
        : priority ? `U.S. shipping · Free ${free!.label} on orders of ${dollars(freeThreshold)} or more.` : `U.S. shipping · Free standard delivery on orders of ${dollars(freeThreshold)} or more.`;
    const overnight = options?.services ? (options.overnightEnabled ? 'Overnight delivery is offered at checkout when a carrier serves your address. The complete shipping charge is shown before payment.' : null)
        : options?.overnightEnabled ? `When available for your address, overnight shipping is the carrier's quoted rate plus a ${dollars(options.overnightHandlingCents)} handling fee. The complete shipping charge is shown before payment.` : null;
    return { freeThreshold, freeLabel: freeThreshold === null ? null : freeLabel, standard, banner, overnight, dispatch: shippingCutoffTerms };
}
/** Same wording basis as the shipping FAQ: weekday orders before 2 p.m. Pacific normally process the same business day. */
export const shippingCutoff = { hour: 14, timeZone: 'America/Los_Angeles' } as const;
/** 14:00 Pacific as an ISO time with today's offset (PDT or PST), for schema.org cutoffTime. */
export function shippingCutoffTime(now = new Date()) {
    let offset = '-08:00';
    try {
        const name = new Intl.DateTimeFormat('en-US', { timeZone: shippingCutoff.timeZone, timeZoneName: 'longOffset' }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || '';
        const match = /^GMT([+-]\d{2}:\d{2})$/.exec(name);
        if (match) offset = match[1];
    } catch { /* keep standard time */ }
    return String(shippingCutoff.hour).padStart(2, '0') + ':00:00' + offset;
}
export const shippingCutoffTerms = 'In-stock weekday orders placed before 2 p.m. Pacific normally process the same business day, excluding federal holidays.';
export const shippingDispatchTerms = 'Carrier delivery estimates start after dispatch, not when the order is placed. Overnight service does not speed up preorder availability or order processing. Weekends, holidays, carrier cutoffs and destination restrictions may affect delivery; an arrival date is not guaranteed by this store.';
