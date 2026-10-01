import { createHmac, timingSafeEqual } from 'node:crypto';
// EasyPost shipping: live checkout rates, label purchase and tracking webhooks.
// Everything stays off until EASYPOST_API_KEY is set; checkout then falls back to the flat rate in store settings.
type Environment = Record<string, string | undefined>;
export type ShipAddress = { name: string; line1: string; line2?: string; city: string; state: string; zip: string; phone?: string; email?: string };
export type ShipItem = { quantity: number; product: { categories?: { slug: string }[] } };
export type Parcel = { length: number; width: number; height: number; weight: number };
export type Rate = { id: string; carrier: string; service: string; cents: number; days: number | null };
export class ShippingError extends Error {
    constructor(message: string) { super(message); this.name = 'ShippingError'; }
}
const API = 'https://api.easypost.com/v2';
const number = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };
export const easypostReady = (env: Environment) => (env.EASYPOST_API_KEY || '').trim().length >= 10;
/** Carrier names as EasyPost reports them. UPS through EasyPost's own account appears as UPSDAP, so matching is by prefix. */
export const allowedCarriers = (env: Environment) => (env.EASYPOST_CARRIERS || 'USPS,UPS').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
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
function rates(shipment: Record<string, any>, env: Environment): Rate[] {
    const allowed = allowedCarriers(env);
    return (Array.isArray(shipment.rates) ? shipment.rates : [])
        .filter((r: any) => typeof r?.carrier === 'string' && allowed.some(c => r.carrier.toUpperCase().startsWith(c)))
        .map((r: any) => ({ id: String(r.id), carrier: String(r.carrier).replace(/DAP$/, ''), service: String(r.service || ''), cents: Math.round(Number(r.rate) * 100), days: Number.isFinite(Number(r.delivery_days)) ? Number(r.delivery_days) : null }))
        .filter((r: Rate) => Number.isSafeInteger(r.cents) && r.cents > 0)
        .sort((a: Rate, b: Rate) => a.cents - b.cents);
}
async function createShipment(env: Environment, to: ShipAddress, items: ShipItem[], reference?: string) {
    return call(env, '/shipments', { shipment: { to_address: toAddress(to), from_address: shipFrom(env), parcel: parcelFor(items, env), reference } });
}
export const serviceName = (r: Pick<Rate, 'carrier' | 'service'>) => r.carrier + ' ' + r.service.replace(/([a-z])([A-Z])/g, '$1 $2');
/** Cheapest allowed rate for this cart and address, plus an optional handling fee (SHIP_HANDLING_CENTS). */
export async function cheapestRate(env: Environment, to: ShipAddress, items: ShipItem[]): Promise<{ cents: number; service: string }> {
    const shipment = await createShipment(env, to, items);
    const best = rates(shipment, env)[0];
    if (!best)
        throw new ShippingError('No USPS or UPS rate is available for this address.');
    const handling = Math.max(0, Math.round(number(env.SHIP_HANDLING_CENTS, 0)));
    return { cents: best.cents + handling, service: serviceName(best) };
}
export type Label = { shipmentId: string; carrier: string; service: string; costCents: number; tracking: string; trackingUrl: string; labelUrl: string; status: string };
/** Buys the cheapest allowed label. Called only from the admin page for a paid order. */
export async function buyLabel(env: Environment, to: ShipAddress, items: ShipItem[], reference: string): Promise<Label> {
    const shipment = await createShipment(env, to, items, reference);
    const best = rates(shipment, env)[0];
    if (!best)
        throw new ShippingError('No USPS or UPS rate is available for this address.');
    const bought = await call(env, '/shipments/' + encodeURIComponent(String(shipment.id)) + '/buy', { rate: { id: best.id } });
    const tracking = String(bought.tracking_code || '');
    const labelUrl = String(bought.postage_label?.label_url || '');
    if (!tracking || !labelUrl)
        throw new ShippingError('EasyPost bought the label but did not return tracking. Check the EasyPost dashboard before retrying.');
    return { shipmentId: String(bought.id), carrier: best.carrier, service: serviceName(best), costCents: best.cents, tracking, trackingUrl: String(bought.tracker?.public_url || ''), labelUrl, status: 'pre_transit' };
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
/** Sends the tracking email through Resend. Returns false (without throwing) when email is not configured. */
export async function sendTrackingEmail(env: Environment, to: string, orderId: string, label: Label, name = ''): Promise<boolean> {
    const key = (env.RESEND_API_KEY || '').trim();
    if (!key || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
        return false;
    const link = label.trackingUrl || 'https://trybiomod.com/account/orders';
    // Brand colors match the storefront: plum (#2b1030) and cream (#fbf1ea).
    const html = '<div style="background:#fbf1ea;padding:24px 16px">'
        + '<div style="font-family:Arial,sans-serif;color:#141414;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e9d9ef;border-radius:8px;overflow:hidden">'
        + '<div style="background:#2b1030;color:#fbf1ea;padding:16px 20px;font-size:20px;font-weight:bold;letter-spacing:2px">BIOMOD</div>'
        + '<div style="padding:20px">'
        + '<h2 style="margin:0 0 12px;color:#2b1030">Your BIOMOD order has shipped</h2>'
        + '<p>' + (name ? 'Hi ' + esc(name.split(' ')[0]) + ', y' : 'Y') + 'our order ' + esc(orderId.slice(0, 8)) + ' is on its way via ' + esc(label.service) + '.</p>'
        + '<p><strong>Tracking number:</strong> ' + esc(label.tracking) + '</p>'
        + '<p><a href="' + esc(link) + '" style="display:inline-block;background:#2b1030;color:#fbf1ea;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Track your package</a></p>'
        + '<p style="font-size:12px;color:#5c5c5c">For laboratory research use only. Questions? Reply to contact@trybiomod.com.</p>'
        + '</div></div></div>';
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.SHIP_EMAIL_FROM || 'BIOMOD <no-reply@trybiomod.com>', to: [to], reply_to: 'contact@trybiomod.com', subject: 'Your BIOMOD order ' + orderId.slice(0, 8) + ' has shipped', html }),
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
