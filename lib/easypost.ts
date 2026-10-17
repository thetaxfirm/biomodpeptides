import { createHmac, timingSafeEqual } from 'node:crypto';
import { shipmentEmailText } from './fulfillment';
import { normalizeShippingOptions, shippingCarrier, shippingTier, shippingTierEnabled, shippingHandling, serviceKey, enabledServiceSetting, catalogService, shippingCarriers, type ShippingOptionsConfig, type ShippingOption, type ShippingCarrier, minimumService, tierRank, labelProtection } from './shipping-options';
// EasyPost shipping: live checkout rates, label purchase and tracking webhooks.
// Everything stays off until EASYPOST_API_KEY is set; checkout then falls back to the flat rate in store settings.
type Environment = Record<string, string | undefined>;
export type ShipAddress = { name: string; line1: string; line2?: string; city: string; state: string; zip: string; phone?: string; email?: string };
export type ShipItem = { quantity: number; product: { categories?: { slug: string }[] } };
export type Parcel = { length: number; width: number; height: number; weight: number };
export type Rate = { id: string; carrier: string; service: string; cents: number; days: number | null };
export class ShippingError extends Error {
    /**
     * `code` lets a caller tell one refusal from another without reading the message. The automatic
     * buyer needs that: a price above its ceiling is a decision for a person, not a failure to retry.
     */
    code?: string;
    cents?: number;
    constructor(message: string, code?: string, cents?: number) { super(message); this.name = 'ShippingError'; this.code = code; this.cents = cents; }
}
const API = 'https://api.easypost.com/v2';
const number = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };
export const easypostReady = (env: Environment) => (env.EASYPOST_API_KEY || '').trim().length >= 10;
/** Carrier names as EasyPost reports them. UPSDAP is an explicit UPS alias. */
export const allowedCarriers = (env: Environment) => normalizeShippingOptions(undefined, env).carriers;
export function shipFrom(env: Environment) {
    return {
        name: env.SHIP_FROM_NAME || 'BIOMOD',
        street1: env.SHIP_FROM_STREET1 || '6625 S Valley View Blvd',
        street2: env.SHIP_FROM_STREET2 ?? 'Suite D420',
        city: env.SHIP_FROM_CITY || 'Las Vegas',
        state: env.SHIP_FROM_STATE || env.STORE_ORIGIN_STATE || 'NV',
        zip: env.SHIP_FROM_ZIP || env.STORE_ORIGIN_ZIP || '89118',
        country: 'US',
        phone: env.SHIP_FROM_PHONE || '7024982144',
    };
}
/** Package estimate: one box plus a per-unit weight. Vials are light; softgel and spray bottles are heavier. Override with env values. */
export function parcelFor(items: ShipItem[], env: Environment): Parcel {
    const [length, width, height] = (env.SHIP_BOX_INCHES || '8x6x4').split('x').map(v => number(v, 6));
    let weight = number(env.SHIP_BOX_OZ, 6);
    for (const item of items) {
        const slugs = (item.product.categories || []).map(c => c.slug);
        const each = slugs.includes('research-compounds') ? number(env.SHIP_VIAL_OZ, 1.5) : slugs.some(s => s === 'softgels' || s === 'spray-products') ? number(env.SHIP_BOTTLE_OZ, 5) : number(env.SHIP_OTHER_OZ, 4);
        weight += each * Math.max(0, item.quantity);
    }
    return { length, width, height, weight: Math.round(weight * 10) / 10 };
}
function toAddress(a: ShipAddress) {
    return { name: a.name, street1: a.line1, street2: a.line2 || '', city: a.city, state: a.state, zip: a.zip, country: 'US', phone: (a.phone || '').replace(/[^0-9]/g, '').slice(-10) || undefined, email: a.email || undefined };
}
async function call(env: Environment, path: string, body?: unknown): Promise<Record<string, any>> {
    if (!easypostReady(env))
        throw new ShippingError('EasyPost is not connected.');
    let response: Response;
    try {
        response = await fetch(API + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Authorization: 'Basic ' + btoa(env.EASYPOST_API_KEY!.trim() + ':'), 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'manual', // Workers reject 'error'; a 3xx is not ok and is rejected below.
            signal: AbortSignal.timeout(15000),
        });
    }
    catch {
        throw new ShippingError('EasyPost could not be reached.');
    }
    let data: Record<string, any> = {};
    try { data = await response.json() as Record<string, any>; } catch { /* handled below */ }
    if (!response.ok) {
        const message = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 200) : 'request failed (' + response.status + ')';
        throw new ShippingError('EasyPost: ' + message);
    }
    return data;
}
function rates(shipment: Record<string, any>, env: Environment, carriers = allowedCarriers(env)): Rate[] {
    if (shipment.mode !== 'production') throw new ShippingError('Live carrier rates are unavailable.');
    return (Array.isArray(shipment.rates) ? shipment.rates : [])
        .filter((r: any) => r?.mode !== 'test' && r?.currency === 'USD' && shippingCarrier(r?.carrier) !== null && carriers.includes(shippingCarrier(r.carrier)!))
        .map((r: any) => ({ id: String(r.id || ''), carrier: shippingCarrier(r.carrier)!, service: String(r.service || ''), cents: typeof r.rate === 'string' && /^\d+(?:\.\d{1,2})?$/.test(r.rate) ? Math.round(Number(r.rate) * 100) : NaN, days: typeof r.delivery_days === 'number' && Number.isSafeInteger(r.delivery_days) && r.delivery_days >= 1 && r.delivery_days <= 60 ? r.delivery_days : null }))
        .filter((r: Rate) => /^rate_[a-zA-Z0-9_]+$/.test(r.id) && /^[a-zA-Z0-9_ -]{1,100}$/.test(r.service) && Number.isSafeInteger(r.cents) && r.cents > 0 && r.cents <= 10000000)
        .sort((a: Rate, b: Rate) => a.cents - b.cents || a.id.localeCompare(b.id));
}
/**
 * `options` is only ever passed when buying a label. Quoting deliberately leaves it off: delivery
 * confirmation changes the rate, and the store pays for it rather than raising the customer's price.
 */
async function createShipment(env: Environment, to: ShipAddress, items: ShipItem[], reference?: string, options?: Record<string, string>) {
    return call(env, '/shipments', { shipment: { to_address: toAddress(to), from_address: shipFrom(env), parcel: parcelFor(items, env), reference, ...(options ? { options } : {}) } });
}
export const serviceName = (r: Pick<Rate, 'carrier' | 'service'>) => r.carrier + ' ' + r.service.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
/** Customer options from already-fetched rates. Checkout and the admin live check share this exact pricing. */
export function shippingOptionsFromRates(available: Rate[], settings: ShippingOptionsConfig, freeStandard = false): ShippingOption[] {
    const result: ShippingOption[] = [];
    if (settings.services) {
        // Per-service mode: every service the owner turned on, at carrier price plus the owner's extra.
        const seen = new Set<string>();
        let freeUsed = false;
        for (const rate of available) {
            const carrier = rate.carrier as ShippingCarrier, key = serviceKey(carrier, rate.service);
            const chosen = enabledServiceSetting(settings, key);
            const tier = shippingTier(carrier, rate.service, rate.days);
            if (!chosen || !tier || seen.has(key)) continue;
            seen.add(key);
            // Rates arrive in carrier-cost order, so free standard goes to the enabled standard service that costs the store least.
            const free = freeStandard && tier === 'standard' && !freeUsed;
            if (free) freeUsed = true;
            result.push({ id: rate.id, tier, shippingService: free ? 'Free · ' + chosen.label : chosen.label, shipping: free ? 0 : rate.cents + chosen.markupCents, carrierCents: rate.cents, handlingCents: chosen.markupCents, days: rate.days, carrier, carrierService: rate.service, source: 'easypost', free, ...(chosen.note ? { note: chosen.note } : {}), serviceKey: key });
        }
        return result.sort((a, b) => a.shipping - b.shipping || a.id.localeCompare(b.id));
    }
    for (const tier of ['standard', 'expedited', 'overnight'] as const) {
        if (!shippingTierEnabled(settings, tier)) continue;
        const rate = available.find(r => shippingTier(r.carrier as ShippingCarrier, r.service, r.days) === tier);
        if (!rate) continue;
        const handlingCents = shippingHandling(settings, tier);
        const free = tier === 'standard' && freeStandard;
        result.push({ id: rate.id, tier, shippingService: free ? 'Free standard shipping · ' + serviceName(rate) : serviceName(rate), shipping: free ? 0 : rate.cents + handlingCents, carrierCents: rate.cents, handlingCents, days: rate.days, carrier: rate.carrier as ShippingCarrier, carrierService: rate.service, source: 'easypost', free });
    }
    return result;
}
/** Live checkout options for the enabled services or tiers. */
export async function carrierShippingOptions(env: Environment, to: ShipAddress, items: ShipItem[], settings: ShippingOptionsConfig, freeStandard = false): Promise<ShippingOption[]> {
    const shipment = await createShipment(env, to, items);
    return shippingOptionsFromRates(rates(shipment, env, settings.carriers), settings, freeStandard);
}
export type ServiceCheck = { key: string; label: string; status: 'ok' | 'missing' | 'wrong'; carrierCents: number | null; markupCents: number; customerCents: number | null; days: number | null; message: string };
/** Admin live check: one real rate request to a sample address, run through the same pricing checkout uses. Buys nothing. */
export async function liveShippingCheck(env: Environment, to: ShipAddress, items: ShipItem[], settings: ShippingOptionsConfig) {
    const shipment = await createShipment(env, to, items);
    const all = rates(shipment, env, [...shippingCarriers]);
    const offered = shippingOptionsFromRates(all.filter(r => settings.carriers.includes(r.carrier as ShippingCarrier)), settings, false);
    const withFree = shippingOptionsFromRates(all.filter(r => settings.carriers.includes(r.carrier as ShippingCarrier)), settings, true);
    const services: ServiceCheck[] = (settings.services || []).filter(s => s.enabled).map(s => {
        const option = offered.find(o => o.serviceKey === s.key);
        const rate = all.find(r => serviceKey(r.carrier as ShippingCarrier, r.service) === s.key);
        if (!option) return { key: s.key, label: s.label, status: 'missing', carrierCents: rate?.cents ?? null, markupCents: s.markupCents, customerCents: null, days: rate?.days ?? null, message: rate ? 'The carrier returned a rate, but it could not be offered. Contact support before relying on it.' : 'The carrier did not offer this service for the sample address and package. Customers will not see it there.' };
        const right = option.shipping === option.carrierCents! + s.markupCents && option.shippingService === s.label && option.handlingCents === s.markupCents;
        return { key: s.key, label: s.label, status: right ? 'ok' : 'wrong', carrierCents: option.carrierCents, markupCents: s.markupCents, customerCents: option.shipping, days: option.days, message: right ? 'Shown at checkout at the carrier price plus your extra.' : 'The checkout price did not match your settings.' };
    });
    const freeOption = withFree.find(o => o.free) || null;
    return {
        checkedAt: new Date().toISOString(),
        rates: all.map(r => ({ key: serviceKey(r.carrier as ShippingCarrier, r.service), carrier: r.carrier, service: r.service, name: catalogService(serviceKey(r.carrier as ShippingCarrier, r.service))?.name || serviceName(r), cents: r.cents, days: r.days, tier: shippingTier(r.carrier as ShippingCarrier, r.service, r.days) })),
        options: offered.map(o => ({ label: o.shippingService, note: o.note || '', cents: o.shipping, days: o.days, tier: o.tier })),
        services,
        freeStandardLabel: freeOption ? freeOption.shippingService : null,
    };
}
/** Legacy API retained for integrations; checkout uses explicit carrierShippingOptions. */
export async function cheapestRate(env: Environment, to: ShipAddress, items: ShipItem[]): Promise<{ cents: number; service: string }> {
    const shipment = await createShipment(env, to, items);
    const best = rates(shipment, env)[0];
    if (!best) throw new ShippingError('No allowed carrier rate is available for this address.');
    return { cents: best.cents + normalizeShippingOptions(undefined, env).standardHandlingCents, service: serviceName(best) };
}
export type Label = { shipmentId: string; carrier: string; service: string; costCents: number; tracking: string; trackingUrl: string; labelUrl: string; status: string; signature?: string | null; insuredCents?: number | null };
export type LabelSelection = Pick<ShippingOption, 'carrier' | 'carrierService' | 'tier' | 'source'> & { shippingService?: string };
/**
 * Idempotency hooks. A purchase that times out may already have been charged, so the caller records
 * the shipment before the buy and hands it back on a retry: an already-bought shipment is adopted
 * rather than replaced, which is the only thing standing between a slow carrier and double postage.
 */
export type LabelAttempt = { resumeShipmentId?: string; onShipment?: (shipmentId: string) => Promise<void>; maxCents?: number; valueCents?: number | null };
/** A shipment EasyPost has already bought. Reading it is how a retry avoids paying twice. */
export function boughtLabel(shipment: Record<string, any>): Label | null {
    if (shipment?.mode !== 'production') return null;
    const rate = shipment.selected_rate;
    const tracking = String(shipment.tracking_code || '');
    const labelUrl = String(shipment.postage_label?.label_url || '');
    if (!rate || !tracking || !/^https:\/\//i.test(labelUrl)) return null;
    const carrier = shippingCarrier(rate.carrier);
    const service = String(rate.service || '');
    const cents = typeof rate.rate === 'string' && /^\d+(?:\.\d{1,2})?$/.test(rate.rate) ? Math.round(Number(rate.rate) * 100) : NaN;
    if (!carrier || !/^[a-zA-Z0-9_ -]{1,100}$/.test(service) || !Number.isSafeInteger(cents) || cents <= 0) return null;
    return { shipmentId: String(shipment.id), carrier, service: serviceName({ carrier, service }), costCents: cents, tracking, trackingUrl: String(shipment.tracker?.public_url || ''), labelUrl, status: 'pre_transit', ...protectionOf(shipment) };
}
/** What EasyPost says this shipment carries: the signature asked for and the insured amount. */
function protectionOf(shipment: Record<string, any>) {
    const signature = typeof shipment?.options?.delivery_confirmation === 'string' ? shipment.options.delivery_confirmation : null;
    const insured = typeof shipment?.insurance === 'string' && /^\d+(?:\.\d{1,2})?$/.test(shipment.insurance) ? Math.round(Number(shipment.insurance) * 100) : null;
    return { signature, insuredCents: insured && insured > 0 ? insured : null };
}
/** Read-only: has this shipment already been bought? Used to recover an attempt whose outcome was lost. */
export async function readBoughtLabel(env: Environment, shipmentId: string): Promise<Label | null> {
    if (!/^shp_[a-zA-Z0-9]+$/.test(shipmentId)) return null;
    const shipment = await call(env, '/shipments/' + encodeURIComponent(shipmentId));
    return shipment.id === shipmentId ? boughtLabel(shipment) : null;
}
/** Re-rate at packing time, but never replace the service the customer paid for with a cheaper one. */
export async function buyLabel(env: Environment, to: ShipAddress, items: ShipItem[], reference: string, selected?: LabelSelection | { shippingService?: string }, settings = normalizeShippingOptions(undefined, env), attempt: LabelAttempt = {}): Promise<Label> {
    let shipment: Record<string, any>;
    if (attempt.resumeShipmentId) {
        // A previous attempt reached EasyPost. Never create a second shipment for the same order.
        if (!/^shp_[a-zA-Z0-9]+$/.test(attempt.resumeShipmentId)) throw new ShippingError('The recorded carrier shipment reference is invalid. Review this order in EasyPost before retrying.');
        shipment = await call(env, '/shipments/' + encodeURIComponent(attempt.resumeShipmentId));
        const already = boughtLabel(shipment);
        if (already) return already;
    } else {
        // Delivery confirmation is requested here, so it is priced into every rate we then choose from.
        const { signature } = labelProtection(settings, attempt.valueCents);
        shipment = await createShipment(env, to, items, reference, signature ? { delivery_confirmation: signature } : undefined);
        // Recorded before the buy, so an unknown outcome can be resolved instead of repeated.
        if (attempt.onShipment) await attempt.onShipment(String(shipment.id));
    }
    const precise = selected && 'carrier' in selected && selected.source === 'easypost';
    const carrier = precise ? shippingCarrier(selected.carrier) : null;
    if (precise && (!carrier || !selected.carrierService)) throw new ShippingError('The saved shipping service is invalid. Review this order before buying a label.');
    // A later settings change cannot silently downgrade an already purchased service.
    const historicalCarrier = !precise && selected?.shippingService ? shippingCarrier(selected.shippingService.trim().split(' ')[0]) : null;
    const floor = minimumService(settings);
    const floorCarrier = floor ? [floor.carrier] : [];
    const available = rates(shipment, env, [...new Set([...(carrier ? [carrier] : historicalCarrier ? [historicalCarrier] : settings.carriers), ...floorCarrier])]);
    let best: Rate | undefined;
    if (precise) best = available.find(r => r.carrier === carrier && r.service === selected.carrierService && shippingTier(r.carrier as ShippingCarrier, r.service, r.days) === selected.tier);
    else {
        const historical = selected?.shippingService?.trim() || '';
        const generic = !historical || /^(?:free )?standard shipping$|^shipping$/i.test(historical);
        if (!generic && !(selected && 'source' in selected && selected.source === 'flat')) {
            best = available.find(r => serviceName(r).toLowerCase() === historical.toLowerCase());
        } else best = available.find(r => shippingTier(r.carrier as ShippingCarrier, r.service, r.days) === 'standard');
    }
    if (!best) throw new ShippingError('The paid shipping service is not available for this address. No label was purchased. Review the order shipping selection.');
    // Store minimum service: only ever an upgrade, at the store's expense. The customer's saved charge is untouched.
    if (floor) {
        const chosenTier = shippingTier(best.carrier as ShippingCarrier, best.service, best.days);
        const floorRate = available.find(r => serviceKey(r.carrier as ShippingCarrier, r.service) === floor.key);
        if (floorRate && chosenTier && tierRank(floor.group) > tierRank(chosenTier)) best = floorRate;
    }
    // A ceiling the caller sets, checked before any money moves. Only unattended buying passes one:
    // a person clicking Buy has already decided, and should not be blocked by a limit meant for a robot.
    // Carries a code and the quoted price, so the caller can hand the decision to a person by name
    // rather than treat an expensive label as an error to try again.
    if (typeof attempt.maxCents === 'number' && best.cents > attempt.maxCents)
        throw new ShippingError('This label would cost $' + (best.cents / 100).toFixed(2) + ', above the automatic limit of $' + (attempt.maxCents / 100).toFixed(2) + '. Buy it by hand to approve that cost.', 'label_above_limit', best.cents);
    // Insurance is bought with the label, on the goods' value, at the store's expense.
    const { insuredCents } = labelProtection(settings, attempt.valueCents);
    const bought = await call(env, '/shipments/' + encodeURIComponent(String(shipment.id)) + '/buy', { rate: { id: best.id }, ...(insuredCents ? { insurance: (insuredCents / 100).toFixed(2) } : {}) });
    const tracking = String(bought.tracking_code || '');
    const labelUrl = String(bought.postage_label?.label_url || '');
    if (!tracking || !labelUrl)
        throw new ShippingError('EasyPost bought the label but did not return tracking. Check the EasyPost dashboard before retrying.');
    return { shipmentId: String(bought.id), carrier: best.carrier, service: serviceName(best), costCents: best.cents, tracking, trackingUrl: String(bought.tracker?.public_url || ''), labelUrl, status: 'pre_transit', ...protectionOf(bought) };
}
/** EasyPost signs webhooks with X-Hmac-Signature: hmac-sha256-hex=<HMAC-SHA256 of the raw body using the webhook secret>. */
export function verifyEasypostWebhook(raw: string, header: string | null, secret: string): boolean {
    const match = /^hmac-sha256-hex=([a-f0-9]{64})$/i.exec((header || '').trim());
    if (!match || secret.length < 8)
        return false;
    const expected = createHmac('sha256', secret.normalize('NFKD')).update(raw, 'utf8').digest();
    const received = Buffer.from(match[1], 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
}
const esc = (v: string) => v.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
/** Sends the tracking email through Resend. Uses the current configured reply address supplied by the caller. Returns false when mail or that reply address is unavailable. */
export async function sendTrackingEmail(env: Environment, to: string, orderId: string, label: Label, name = '', replyTo = ''): Promise<boolean> {
    const key = (env.RESEND_API_KEY || '').trim();
    if (!key || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
        return false;
    const reply = replyTo.trim();
    if (replyTo.length > 254 || /[\x00-\x1f\x7f]/.test(replyTo) || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(reply))
        return false;
    const link = label.trackingUrl || 'https://trybiomod.com/account/orders';
    // Brand colors match the storefront: plum (#2b1030) and cream (#fbf1ea).
    const html = '<div style="background:#fbf1ea;padding:24px 16px">'
        + '<div style="font-family:Arial,sans-serif;color:#141414;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e9d9ef;border-radius:8px;overflow:hidden">'
        + '<div style="background:#2b1030;color:#fbf1ea;padding:16px 20px;font-size:20px;font-weight:bold;letter-spacing:2px">BIOMOD</div>'
        + '<div style="padding:20px">'
        + '<h2 style="margin:0 0 12px;color:#2b1030">Tracking for your BIOMOD order</h2>'
        + '<p>' + (name ? 'Hi ' + esc(name.split(' ')[0]) + ', y' : 'Y') + 'our order ' + esc(orderId.slice(0, 8)) + ' has tracking with ' + esc(label.service) + '.</p>'
        + '<p>' + esc(shipmentEmailText(label.status)) + '</p>'
        + '<p><strong>Tracking number:</strong> ' + esc(label.tracking) + '</p>'
        + '<p><a href="' + esc(link) + '" style="display:inline-block;background:#2b1030;color:#fbf1ea;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Track your package</a></p>'
        + '<p style="font-size:12px;color:#5c5c5c">For laboratory research use only. Questions? Reply to ' + esc(reply) + '.</p>'
        + '</div></div></div>';
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.SHIP_EMAIL_FROM || 'BIOMOD <contact@trybiomod.com>', to: [to], reply_to: reply, subject: 'Your BIOMOD order ' + orderId.slice(0, 8) + ' tracking information', html }),
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}

/** Read-only carrier diagnostics. Never exposes account IDs, addresses or credentials. */
export async function shippingConnection(env: Environment) {
    const checkedAt = new Date().toISOString();
    const configured = easypostReady(env);
    const webhookConfigured = Boolean(env.EASYPOST_WEBHOOK_SECRET?.trim());
    if (!configured) return { configured, connected: false, checkedAt, message: 'Carrier connection is not configured.', webhookConfigured, webhookRegistered: null };
    try { await call(env, '/carrier_accounts'); }
    catch { return { configured, connected: false, checkedAt, message: 'Carrier connection could not be verified. Check the EasyPost account.', webhookConfigured, webhookRegistered: null }; }
    // Webhook availability is independent of whether the API authenticated.
    let webhookRegistered: boolean | null = null;
    try {
        const hooks = await call(env, '/webhooks');
        if (Array.isArray(hooks.webhooks)) webhookRegistered = hooks.webhooks.some((h: any) => h.url === 'https://trybiomod.com/api/shipping/easypost' && !h.disabled_at);
    } catch { /* API access worked; webhook state is unavailable, not disconnected. */ }
    return { configured, connected: true, checkedAt, message: 'EasyPost accepted the connection check.', webhookConfigured, webhookRegistered };
}
export async function readShipmentTracking(env: Environment, shipmentId: string, tracking: string) {
    if (!/^shp_[a-zA-Z0-9]+$/.test(shipmentId)) throw new ShippingError('This order has no valid carrier shipment reference.');
    const shipment = await call(env, '/shipments/' + encodeURIComponent(shipmentId));
    if (shipment.mode !== 'production' || shipment.id !== shipmentId || shipment.tracking_code !== tracking || shipment.tracker?.tracking_code !== tracking)
        throw new ShippingError('Carrier tracking did not match this production shipment. No order changes were saved.');
    const status = shipment.tracker?.status;
    if (!['unknown', 'pre_transit', 'in_transit', 'out_for_delivery', 'delivered', 'available_for_pickup', 'return_to_sender', 'failure', 'cancelled', 'error'].includes(status))
        throw new ShippingError('Carrier tracking status is unavailable.');
    return status as string;
}
