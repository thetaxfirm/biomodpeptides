// Shared, browser-safe shipping settings and immutable selected-service snapshots.
export const shippingCarriers = ['USPS', 'UPS', 'FedEx'] as const;
export type ShippingCarrier = typeof shippingCarriers[number];
export type ShippingTier = 'standard' | 'expedited' | 'overnight';
export type ShippingOptionsConfig = {
    standardEnabled: boolean; expeditedEnabled: boolean; overnightEnabled: boolean; freeStandardEnabled: boolean;
    standardHandlingCents: number; expeditedHandlingCents: number; overnightHandlingCents: number;
    carriers: ShippingCarrier[];
    /** Per-service mode. When present, these replace the tier toggles and per-tier fees. */
    services?: ShippingServiceSetting[];
    /** Catalog key of the slowest service the store will hand to a carrier. Upgrades only; the customer is never charged more. */
    minimumServiceKey?: string;
    /** Delivery confirmation asked of the carrier when a label is bought. The store pays for it. */
    signatureConfirmation?: string;
    /** Ask for the signature only on orders whose goods are worth at least this. Null: every order. Owner-set. */
    signatureOverCents?: number | null;
    /** Insure the goods' value on orders worth at least this. Null: never insure. Owner-set. */
    insureOverCents?: number | null;
};
/** One carrier service the owner chose to offer: the extra charged on top of the carrier price and the customer wording. */
export type ShippingServiceSetting = { key: string; enabled: boolean; markupCents: number; label: string; note: string };
export type CatalogService = { key: string; carrier: ShippingCarrier; service: string; name: string; group: ShippingTier; detail: string };
const catalogRow = (carrier: ShippingCarrier, service: string, name: string, group: ShippingTier, detail: string): CatalogService => ({ key: serviceKey(carrier, service), carrier, service, name, group, detail });
/** Domestic services EasyPost returns for the connected USPS, UPS and FedEx accounts. Live rates can add more. */
export const shippingServiceCatalog: CatalogService[] = [
    catalogRow('USPS', 'GroundAdvantage', 'USPS Ground Advantage', 'standard', 'Usually 2 to 5 business days'),
    catalogRow('USPS', 'Priority', 'USPS Priority Mail', 'expedited', 'Usually 1 to 3 business days'),
    catalogRow('USPS', 'Express', 'USPS Priority Mail Express', 'overnight', 'Usually 1 to 2 days, 7 days a week'),
    catalogRow('UPS', 'Ground', 'UPS Ground', 'standard', 'Usually 1 to 5 business days'),
    catalogRow('UPS', 'UPSGroundsaver', 'UPS Ground Saver', 'standard', 'Economy, usually 2 to 7 business days'),
    catalogRow('UPS', '3DaySelect', 'UPS 3 Day Select', 'expedited', '3 business days'),
    catalogRow('UPS', '2ndDayAir', 'UPS 2nd Day Air', 'expedited', '2 business days'),
    catalogRow('UPS', '2ndDayAirAM', 'UPS 2nd Day Air A.M.', 'expedited', '2 business days, by morning'),
    catalogRow('UPS', 'NextDayAirSaver', 'UPS Next Day Air Saver', 'overnight', 'Next business day, end of day'),
    catalogRow('UPS', 'NextDayAir', 'UPS Next Day Air', 'overnight', 'Next business day, by 10:30 a.m. in most areas'),
    catalogRow('UPS', 'NextDayAirEarlyAM', 'UPS Next Day Air Early', 'overnight', 'Next business day, early morning'),
    catalogRow('FedEx', 'FEDEX_GROUND', 'FedEx Ground', 'standard', 'Usually 1 to 5 business days'),
    catalogRow('FedEx', 'GROUND_HOME_DELIVERY', 'FedEx Home Delivery', 'standard', 'Usually 1 to 5 business days to homes'),
    catalogRow('FedEx', 'SMART_POST', 'FedEx Ground Economy', 'standard', 'Economy, usually 2 to 7 business days'),
    catalogRow('FedEx', 'FEDEX_EXPRESS_SAVER', 'FedEx Express Saver', 'expedited', '3 business days'),
    catalogRow('FedEx', 'FEDEX_2_DAY', 'FedEx 2Day', 'expedited', '2 business days'),
    catalogRow('FedEx', 'FEDEX_2_DAY_AM', 'FedEx 2Day A.M.', 'expedited', '2 business days, by morning'),
    catalogRow('FedEx', 'STANDARD_OVERNIGHT', 'FedEx Standard Overnight', 'overnight', 'Next business day, afternoon'),
    catalogRow('FedEx', 'PRIORITY_OVERNIGHT', 'FedEx Priority Overnight', 'overnight', 'Next business day, morning'),
    catalogRow('FedEx', 'FIRST_OVERNIGHT', 'FedEx First Overnight', 'overnight', 'Next business day, early morning'),
];
/** Stable key for a carrier service, insensitive to EasyPost's spelling (FEDEX_2_DAY, Fedex2Day). */
export function serviceKey(carrier: ShippingCarrier, service: string) { return carrier + ':' + service.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(); }
export const catalogService = (key: string) => shippingServiceCatalog.find(s => s.key === key) || null;
/** Slowest to fastest. Used only to decide whether a floor would be an upgrade. */
export const tierRank = (tier: ShippingTier) => tier === 'standard' ? 0 : tier === 'expedited' ? 1 : 2;
/** The store floor when nothing has been configured: never hand a carrier anything slower than USPS Priority Mail. */
export const defaultMinimumServiceKey = 'USPS:PRIORITY';
/** Stored to mean "ship exactly what the customer paid for". Distinct from an absent key, which takes the default. */
export const noMinimumService = 'none';
/**
 * The floor in force: an explicit opt-out, an owner-chosen service, or the default. Only the opt-out
 * returns null, so a key that never passed through normalize cannot quietly remove the floor.
 */
export const minimumService = (settings: Pick<ShippingOptionsConfig, 'minimumServiceKey'>) =>
    settings.minimumServiceKey === noMinimumService ? null
        : catalogService(settings.minimumServiceKey || defaultMinimumServiceKey) || catalogService(defaultMinimumServiceKey);
/**
 * Delivery confirmation, as EasyPost names it. Applied when the label is bought, never when
 * checkout is quoted, so the fee is the store's and no customer sees a price change.
 * INDIRECT_SIGNATURE is USPS only; the carrier simply ignores an option it does not offer.
 */
export const signatureOptions = [
    { key: 'SIGNATURE', name: 'Signature required', detail: 'Someone at the address must sign' },
    { key: 'ADULT_SIGNATURE', name: 'Adult signature (21+)', detail: 'An adult must sign, with ID. Costs more and fails delivery more often' },
    { key: 'INDIRECT_SIGNATURE', name: 'Indirect signature', detail: 'A neighbour may sign. USPS only' },
] as const;
/** Stored to mean "no signature asked for". Distinct from an absent key, which takes the default. */
export const noSignature = 'none';
export const defaultSignatureConfirmation = 'SIGNATURE';
/** The confirmation in force, or null when the store has turned it off. */
/**
 * What one label asks of the carrier, given the goods' value. An unknown value keeps the signature
 * (the safer default) and never buys insurance, since there would be no honest amount to declare.
 */
export function labelProtection(settings: Pick<ShippingOptionsConfig, 'signatureConfirmation' | 'signatureOverCents' | 'insureOverCents'>, valueCents?: number | null) {
    const known = typeof valueCents === 'number' && Number.isSafeInteger(valueCents) && valueCents > 0;
    const asked = signatureConfirmation(settings);
    const over = settings.signatureOverCents;
    const signature = asked && (over == null || !known || valueCents! >= over) ? asked : null;
    const insureOver = settings.insureOverCents;
    const insuredCents = known && insureOver != null && valueCents! >= insureOver ? valueCents! : null;
    return { signature, insuredCents };
}
/** What the customer paid for the goods: subtotal less discounts. Shipping and tax are not insured value. */
export function goodsValueCents(data: { subtotal?: unknown; discount?: unknown } | undefined): number | null {
    const subtotal = Number(data?.subtotal), discount = Number(data?.discount) || 0;
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) return null;
    const value = subtotal - (Number.isSafeInteger(discount) && discount > 0 ? discount : 0);
    return value > 0 ? value : null;
}
export const signatureConfirmation = (settings: Pick<ShippingOptionsConfig, 'signatureConfirmation'>) => {
    const value = settings.signatureConfirmation;
    if (value === noSignature) return null;
    return signatureOptions.some(o => o.key === value) ? value as string : defaultSignatureConfirmation;
};
const plainText = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';
function normalizeServices(value: unknown): ShippingServiceSetting[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>(), result: ShippingServiceSetting[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const v = raw as Record<string, unknown>;
        if (typeof v.key !== 'string' || !/^(USPS|UPS|FedEx):[A-Z0-9]{1,60}$/.test(v.key) || seen.has(v.key)) continue;
        seen.add(v.key);
        result.push({ key: v.key, enabled: v.enabled === true, markupCents: cents(v.markupCents, 0), label: plainText(v.label, 80) || catalogService(v.key)?.name || v.key.replace(':', ' '), note: plainText(v.note, 160) });
    }
    return result;
}
export const enabledServiceSetting = (settings: ShippingOptionsConfig, key: string) => settings.services?.find(s => s.key === key && s.enabled) || null;
export const defaultShippingOptions: ShippingOptionsConfig = {
    standardEnabled: true, expeditedEnabled: true, overnightEnabled: true, freeStandardEnabled: true,
    standardHandlingCents: 0, expeditedHandlingCents: 0, overnightHandlingCents: 1000, carriers: ['USPS', 'UPS'],
};
export type ShippingOption = {
    id: string; tier: ShippingTier; shippingService: string; shipping: number;
    carrierCents: number | null; handlingCents: number; days: number | null;
    carrier: ShippingCarrier | null; carrierService: string | null; source: 'easypost' | 'flat'; free: boolean;
    /** Owner-written customer note and the configured service, in per-service mode. */
    note?: string; serviceKey?: string;
};
/** Only documented provider aliases count; an arbitrary prefix is never a carrier match. */
export function shippingCarrier(value: unknown): ShippingCarrier | null {
    if (typeof value !== 'string') return null;
    const key = value.trim().toUpperCase();
    return key === 'UPS' || key === 'UPSDAP' ? 'UPS' : key === 'USPS' ? 'USPS' : key === 'FEDEX' ? 'FedEx' : null;
}
const cents = (v: unknown, fallback: number, max = 100000) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : fallback;
/** Opting out is explicit. An unknown or misspelled key falls back to the default rather than quietly removing the floor. */
const floor = (v: Record<string, unknown>) => ({
    minimumServiceKey: v.minimumServiceKey === noMinimumService ? noMinimumService
        : typeof v.minimumServiceKey === 'string' && catalogService(v.minimumServiceKey) ? v.minimumServiceKey
        : defaultMinimumServiceKey,
    signatureConfirmation: v.signatureConfirmation === noSignature ? noSignature
        : typeof v.signatureConfirmation === 'string' && signatureOptions.some(o => o.key === v.signatureConfirmation) ? v.signatureConfirmation
        : defaultSignatureConfirmation,
    signatureOverCents: threshold(v.signatureOverCents),
    insureOverCents: threshold(v.insureOverCents),
});
/** An owner-entered dollar threshold, stored in cents. Anything else means "not set". */
function threshold(v: unknown): number | null {
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10000000 ? v : null;
}
export function normalizeShippingOptions(value?: unknown, env: Record<string, string | undefined> = {}): ShippingOptionsConfig {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const legacyHandling = cents(Number(env.SHIP_HANDLING_CENTS || 0), 0);
    const list = Array.isArray(v.carriers) ? v.carriers : (env.EASYPOST_CARRIERS || 'USPS,UPS').split(',');
    const services = normalizeServices(v.services);
    if (services) {
        // Per-service mode: carriers and tier switches follow the services the owner turned on.
        const on = services.filter(s => s.enabled);
        const group = (key: string) => catalogService(key)?.group;
        const carrierOf = (key: string) => shippingCarrier(key.split(':')[0]);
        return {
            standardEnabled: on.some(s => group(s.key) === 'standard'), expeditedEnabled: on.some(s => group(s.key) === 'expedited' || s.key === 'USPS:EXPRESS'), overnightEnabled: on.some(s => group(s.key) === 'overnight'),
            freeStandardEnabled: typeof v.freeStandardEnabled === 'boolean' ? v.freeStandardEnabled : true,
            standardHandlingCents: 0, expeditedHandlingCents: 0, overnightHandlingCents: 0,
            carriers: [...new Set(on.map(s => carrierOf(s.key)).filter((c): c is ShippingCarrier => c !== null))],
            services,
            ...floor(v),
        };
    }
    return {
        standardEnabled: typeof v.standardEnabled === 'boolean' ? v.standardEnabled : true,
        expeditedEnabled: typeof v.expeditedEnabled === 'boolean' ? v.expeditedEnabled : true,
        overnightEnabled: typeof v.overnightEnabled === 'boolean' ? v.overnightEnabled : true,
        freeStandardEnabled: typeof v.freeStandardEnabled === 'boolean' ? v.freeStandardEnabled : true,
        standardHandlingCents: cents(v.standardHandlingCents, legacyHandling),
        expeditedHandlingCents: cents(v.expeditedHandlingCents, legacyHandling),
        overnightHandlingCents: cents(v.overnightHandlingCents, 1000),
        carriers: [...new Set(list.map(shippingCarrier).filter((c): c is ShippingCarrier => c !== null))],
        ...floor(v),
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
        if (['GROUND', 'UPSSTANDARD', 'GROUNDSAVER', 'UPSGROUNDSAVER', 'SUREPOST'].includes(key)) return 'standard';
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
    if (v.note !== undefined && (typeof v.note !== 'string' || v.note.length > 160)) return null;
    if (v.serviceKey !== undefined && (v.source !== 'easypost' || typeof v.serviceKey !== 'string' || v.serviceKey !== serviceKey(carrier!, v.carrierService))) return null;
    return { id: v.id, tier: v.tier, shippingService: v.shippingService, shipping: v.shipping, carrierCents: v.carrierCents, handlingCents: v.handlingCents, days: v.days, carrier, carrierService: v.source === 'flat' ? null : v.carrierService, source: v.source, free: v.free, ...(v.note ? { note: v.note } : {}), ...(v.serviceKey ? { serviceKey: v.serviceKey } : {}) };
}
