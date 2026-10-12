// Shared, browser-safe shipping settings and immutable selected-service snapshots.
export const shippingCarriers = ['USPS', 'UPS', 'FedEx'] as const;
export type ShippingCarrier = typeof shippingCarriers[number];
export type ShippingTier = 'standard' | 'expedited' | 'overnight';
export type ShippingOptionsConfig = {
    standardEnabled: boolean; expeditedEnabled: boolean; overnightEnabled: boolean; freeStandardEnabled: boolean;
    standardHandlingCents: number; expeditedHandlingCents: number; overnightHandlingCents: number;
    carriers: ShippingCarrier[];
};
export const defaultShippingOptions: ShippingOptionsConfig = {
    standardEnabled: true, expeditedEnabled: true, overnightEnabled: true, freeStandardEnabled: true,
    standardHandlingCents: 0, expeditedHandlingCents: 0, overnightHandlingCents: 1000, carriers: ['USPS', 'UPS'],
};
export type ShippingOption = {
    id: string; tier: ShippingTier; shippingService: string; shipping: number;
    carrierCents: number | null; handlingCents: number; days: number | null;
    carrier: ShippingCarrier | null; carrierService: string | null; source: 'easypost' | 'flat'; free: boolean;
};
/** Only documented provider aliases count; an arbitrary prefix is never a carrier match. */
export function shippingCarrier(value: unknown): ShippingCarrier | null {
    if (typeof value !== 'string') return null;
    const key = value.trim().toUpperCase();
    return key === 'UPS' || key === 'UPSDAP' ? 'UPS' : key === 'USPS' ? 'USPS' : key === 'FEDEX' ? 'FedEx' : null;
}
const cents = (v: unknown, fallback: number, max = 100000) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : fallback;
export function normalizeShippingOptions(value?: unknown, env: Record<string, string | undefined> = {}): ShippingOptionsConfig {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const legacyHandling = cents(Number(env.SHIP_HANDLING_CENTS || 0), 0);
    const list = Array.isArray(v.carriers) ? v.carriers : (env.EASYPOST_CARRIERS || 'USPS,UPS').split(',');
    return {
        standardEnabled: typeof v.standardEnabled === 'boolean' ? v.standardEnabled : true,
        expeditedEnabled: typeof v.expeditedEnabled === 'boolean' ? v.expeditedEnabled : true,
        overnightEnabled: typeof v.overnightEnabled === 'boolean' ? v.overnightEnabled : true,
        freeStandardEnabled: typeof v.freeStandardEnabled === 'boolean' ? v.freeStandardEnabled : true,
        standardHandlingCents: cents(v.standardHandlingCents, legacyHandling),
        expeditedHandlingCents: cents(v.expeditedHandlingCents, legacyHandling),
        overnightHandlingCents: cents(v.overnightHandlingCents, 1000),
        carriers: [...new Set(list.map(shippingCarrier).filter((c): c is ShippingCarrier => c !== null))],
    };
}
export const shippingTierEnabled = (settings: ShippingOptionsConfig, tier: ShippingTier) => settings[tier === 'standard' ? 'standardEnabled' : tier === 'expedited' ? 'expeditedEnabled' : 'overnightEnabled'];
export const shippingHandling = (settings: ShippingOptionsConfig, tier: ShippingTier) => settings[tier === 'standard' ? 'standardHandlingCents' : tier === 'expedited' ? 'expeditedHandlingCents' : 'overnightHandlingCents'];
/** Strict domestic service tiers. A ground estimate of one day is not overnight. */
export function shippingTier(carrier: ShippingCarrier, service: string, days: number | null): ShippingTier | null {
    const key = service.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (carrier === 'UPS') {
        if (['NEXTDAYAIR', 'NEXTDAYAIRSAVER', 'NEXTDAYAIREARLYAM'].includes(key)) return 'overnight';
        if (['2NDDAYAIR', '2NDDAYAIRAM', '3DAYSELECT'].includes(key)) return 'expedited';
        if (['GROUND', 'UPSSTANDARD', 'GROUNDSAVER', 'SUREPOST'].includes(key)) return 'standard';
    }
    if (carrier === 'FedEx') {
        if (['FIRSTOVERNIGHT', 'PRIORITYOVERNIGHT', 'STANDARDOVERNIGHT'].includes(key)) return 'overnight';
        if (['FEDEX2DAY', 'FEDEX2DAYAM', 'FEDEXEXPRESSSAVER'].includes(key)) return 'expedited';
        if (['FEDEXGROUND', 'GROUNDHOMEDELIVERY', 'FEDEXHOMEDELIVERY', 'SMARTPOST', 'FEDEXGROUNDECONOMY'].includes(key)) return 'standard';
    }
    if (carrier === 'USPS') {
        if (['EXPRESS', 'PRIORITYMAILEXPRESS'].includes(key)) return days === 1 ? 'overnight' : 'expedited';
        if (['PRIORITY', 'PRIORITYMAIL'].includes(key)) return 'expedited';
        if (['GROUNDADVANTAGE', 'USPSGROUNDADVANTAGE', 'FIRST', 'FIRSTCLASS', 'FIRSTCLASSMAIL', 'PARCELSELECT', 'PARCELSELECTGROUND', 'RETAILGROUND'].includes(key)) return 'standard';
    }
    return null;
}
/** Read only a known selected option. Never regenerate a historical price from current settings. */
export function savedShippingOption(raw: unknown): ShippingOption | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const v = raw as Record<string, any>;
    if (!['standard', 'expedited', 'overnight'].includes(v.tier) || !['easypost', 'flat'].includes(v.source) || typeof v.free !== 'boolean') return null;
    if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(v.id) || typeof v.shippingService !== 'string' || !v.shippingService.trim() || v.shippingService.length > 160) return null;
    if (!Number.isSafeInteger(v.shipping) || v.shipping < 0 || v.shipping > 10000000 || !Number.isSafeInteger(v.handlingCents) || v.handlingCents < 0 || v.handlingCents > 100000) return null;
    if (v.carrierCents !== null && (!Number.isSafeInteger(v.carrierCents) || v.carrierCents < 0 || v.carrierCents > 10000000)) return null;
    if (v.days !== null && (!Number.isSafeInteger(v.days) || v.days < 1 || v.days > 60)) return null;
    const carrier = shippingCarrier(v.carrier);
    if (v.source === 'easypost' && (!carrier || typeof v.carrierService !== 'string' || !/^[a-zA-Z0-9_ -]{1,100}$/.test(v.carrierService) || v.carrierCents === null || shippingTier(carrier, v.carrierService, v.days) !== v.tier)) return null;
    if (v.source === 'flat' && (v.tier !== 'standard' || v.carrier !== null || v.carrierService !== null || v.carrierCents !== null)) return null;
    if (v.free && (v.tier !== 'standard' || v.shipping !== 0)) return null;
    if (!v.free && v.source === 'easypost' && v.shipping !== v.carrierCents + v.handlingCents) return null;
    return { id: v.id, tier: v.tier, shippingService: v.shippingService, shipping: v.shipping, carrierCents: v.carrierCents, handlingCents: v.handlingCents, days: v.days, carrier, carrierService: v.source === 'flat' ? null : v.carrierService, source: v.source, free: v.free };
}
