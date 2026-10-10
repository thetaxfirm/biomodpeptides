import { unavailableOrder } from './catalog-visibility';
import inventorySql from './inventory-statements.json';
import { sendOrderNotification } from './order-summary';
import { quote, CartLine } from './commerce';
import { one, run, uid, timestamp, runtime, parse, database } from './runtime';
import { createPaymentAdapter, paymentEnvironment, paymentReturnUrl } from './payments';
import { fixedTaxConfig, fixedTaxCents } from './tax';
import { z } from 'zod';
import { customer } from './auth';
import { cheapestRate, easypostReady } from './easypost';
export const addressSchema = z.object({ name: z.string().trim().min(2).max(100), line1: z.string().trim().min(3).max(150), line2: z.string().trim().max(150).default(''), city: z.string().trim().min(2).max(100), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Enter a two-letter state abbreviation, such as NV.'), zip: z.string().regex(/^\d{5}(-\d{4})?$/), country: z.literal('US'), phone: z.string().trim().min(7).max(30) });
/** Shipping: free over the threshold, otherwise the live EasyPost rate (when connected) or the flat rate from store settings.
 * A quoted rate is stored with the quote and reused at payment so the total cannot drift between the two steps. */
export async function deliveryQuote(lines: CartLine[], raw: unknown, preset?: { shipping: number; shippingService: string }, promoCode?: unknown) {
    const address = addressSchema.parse(raw);
    const q = await quote(lines, promoCode);
    if (!lines.length)
        throw new Error('Your cart is empty.');
    let shipping: number | null = q.config.shippingCents;
    let shippingService = 'Standard shipping';
    if (q.total >= q.config.freeShippingAt) {
        shipping = 0;
        shippingService = 'Free standard shipping';
    }
    else if (preset && Number.isSafeInteger(preset.shipping) && preset.shipping >= 0) {
        shipping = preset.shipping;
        shippingService = preset.shippingService || shippingService;
    }
    else if (easypostReady(runtime())) {
        try {
            const live = await cheapestRate(runtime(), address, q.items as any);
            shipping = live.cents;
            shippingService = live.service;
        }
        catch (e) {
            // Fall back to the flat rate so checkout keeps working if EasyPost is briefly unavailable.
            console.error('EasyPost rate failed:', e instanceof Error ? e.message : 'unknown error');
        }
    }
    if (shipping === null)
        throw new Error('Delivery pricing is being finalized. Please contact us for help.');
    // TaxJar is used when connected. Otherwise the configured fixed rate applies (lib/tax.ts).
    // With neither configured, checkout stays closed: missing tax setup never becomes zero tax.
    if (!runtime().TAXJAR_API_TOKEN) {
        const fixed = fixedTaxConfig(runtime());
        if (!fixed)
            throw new Error('Checkout is not accepting orders yet. Tax and delivery setup is pending.');
        const tax = fixedTaxCents(fixed, address.state, q.total);
        return { items: q.items, subtotal: q.subtotal, discount: q.discount, packDiscount: q.packDiscount, promoDiscount: q.promoDiscount, promo: q.promo, shipping, shippingService, tax, total: q.total + shipping + tax, address };
    }
    if (!runtime().STORE_ORIGIN_ZIP || !runtime().STORE_ORIGIN_STATE)
        throw new Error('Checkout is not accepting orders yet. Tax and delivery setup is pending.');
    const r = await fetch('https://api.taxjar.com/v2/taxes', { method: 'POST', headers: { Authorization: 'Bearer ' + runtime().TAXJAR_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ from_country: 'US', from_zip: runtime().STORE_ORIGIN_ZIP, from_state: runtime().STORE_ORIGIN_STATE, to_country: 'US', to_zip: address.zip, to_state: address.state, to_city: address.city, to_street: address.line1, amount: q.total / 100, shipping: shipping / 100 }) });
    if (!r.ok)
        throw new Error('Tax could not be calculated. Please try again later.');
    const d = await r.json() as {
        tax?: {
            amount_to_collect?: number;
        };
    };
    const t = d.tax?.amount_to_collect;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0)
        throw new Error('Tax could not be verified.');
    const tax = Math.round(t * 100);
    return { items: q.items, subtotal: q.subtotal, discount: q.discount, packDiscount: q.packDiscount, promoDiscount: q.promoDiscount, promo: q.promo, shipping, shippingService, tax, total: q.total + shipping + tax, address };
}
const quoteFingerprint = (q: Record<string, any>) => JSON.stringify({ items: q.items.map((i: any) => ({ id: i.id, quantity: i.quantity, packId: i.packId || null, packSize: i.packSize || null, packKind: i.packKind || null, lineTotal: i.lineTotal, presaleId: i.presaleId || null, price: i.product.price })), address: q.address, shipping: q.shipping, tax: q.tax, total: q.total, ...(q.promo ? { promoCode: q.promo.code } : {}) });
export async function issueQuote(owner: string, lines: CartLine[], address: unknown, promoCode?: unknown) { const q = await deliveryQuote(lines, address, undefined, promoCode); const id = uid(); await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, owner, 'quote', JSON.stringify({ fingerprint: quoteFingerprint(q), shipping: q.shipping, shippingService: q.shippingService }), timestamp()); return { ...q, quoteId: id }; }
export async function checkout(owner: string, lines: CartLine[], body: Record<string, any>, promoCode?: unknown) {
    if (body.accepted !== true)
        throw new Error('Confirm that you are 21 or older and purchasing for laboratory research only.');
    if (typeof body.requestKey !== 'string' || !/^[a-f0-9-]{36}$/.test(body.requestKey))
        throw new Error('Refresh checkout and try again.');
    const cartQuote = await quote(lines, promoCode);
    const current = addressSchema.parse(body.address);
    const fingerprint = JSON.stringify({ lines, address: current, ...(cartQuote.promo ? { promoCode: cartQuote.promo.code } : {}) });
    const old = await one<{
        id: string;
        status: string;
        checkout_url: string;
        data: string;
    }>('SELECT id,status,checkout_url,data FROM orders WHERE owner=? AND (request_key=? OR status IN (?,?,?,?)) ORDER BY created DESC LIMIT 1', owner, body.requestKey, 'creating', 'awaiting_payment', 'pending', 'review');
    if (old) {
        const saved = parse<Record<string, any>>(old.data, {});
        if (unavailableOrder(saved)) throw new Error('This order contains an unavailable product and requires review.');
        if (saved.environment !== paymentEnvironment(runtime()))
            throw new Error('An existing payment requires review before a new checkout can begin.');
        if (old.checkout_url && ['awaiting_payment', 'pending'].includes(old.status) && saved.fingerprint === fingerprint && saved.total === body.expectedTotal)
            return { id: old.id, url: old.checkout_url };
        throw new Error('You already have an unresolved checkout. Open your orders to verify payment before placing another order.');
    }
    const adapter = createPaymentAdapter(runtime());
    if (!adapter.getStatus().checkoutEnabled)
        throw new Error('Online payment is being connected. No payment has been taken.');
    const receipt = await one<{
        data: string;
        created: number;
    }>('SELECT data,created FROM requests WHERE id=? AND owner=? AND kind=?', String(body.quoteId || ''), owner, 'quote');
    const quoted = parse<Record<string, any>>(receipt?.data, {});
    const q = await deliveryQuote(lines, current, typeof quoted.shipping === 'number' ? { shipping: quoted.shipping, shippingService: String(quoted.shippingService || '') } : undefined, promoCode);
    if (!receipt || timestamp() - receipt.created > 600000 || quoted.fingerprint !== quoteFingerprint(q))
        throw new Error('Your checkout quote changed or expired. Recalculate delivery and review the order again.');
    if (!Number.isInteger(body.expectedTotal) || body.expectedTotal !== q.total)
        throw new Error('Your total changed. Recalculate delivery and review the updated total before paying.');
    if (q.items.some(i => i.product.stockQuantity == null))
        throw new Error('Inventory is awaiting verification. Please contact us before ordering.');
    const campaignId = lines[0]?.presaleId || null;
    const campaign = campaignId ? parse<Record<string, any>>((await one<{
        data: string;
    }>('SELECT data FROM campaigns WHERE id=?', campaignId))?.data, {}) : null;
    const email = (await customer())?.email || '';
    const saved = { ...q, email, fingerprint, environment: paymentEnvironment(runtime()), campaignId, campaignLimit: campaign?.maxPerCustomer || null, unitCount: lines.reduce((s, l) => s + l.quantity, 0) };
    const id = uid();
    const db=database();
    try { await db.batch([
      db.prepare(inventorySql.insertOrder).bind(id,owner,body.requestKey,'creating',JSON.stringify(saved),q.total,adapter.reference(id),timestamp(),timestamp()),
      db.prepare(inventorySql.reserve).bind(id),
      db.prepare(inventorySql.checkReservation).bind(id,id,id),
      db.prepare(inventorySql.clearGuard).bind(id)
    ]); } catch { throw new Error('Inventory, presale limits, or an existing checkout prevented this order. Refresh your cart and check your orders.'); }
    try {
        const result = await adapter.createCheckout({ id, totalCents: q.total, currency: 'USD' }, paymentReturnUrl(runtime())!);
        await run('UPDATE orders SET status=?,checkout_ref=?,checkout_url=?,updated=? WHERE id=?', 'awaiting_payment', result.providerReference, result.url, timestamp(), id);
        return { id, url: result.url };
    }
    catch {
        await run('UPDATE orders SET status=?,updated=? WHERE id=?', 'review', timestamp(), id);
        throw new Error('Checkout could not be confirmed. Please contact us with order ' + id.slice(0, 8) + '. Do not submit another payment.');
    }
}
export async function reconcile(owner: string, id: string, hints: string[] = []) { const row = await one<{
    id: string;
    total: number;
    status: string;
    checkout_ref: string;
    data: string;
    created: number;
}>('SELECT id,total,status,checkout_ref,data,created FROM orders WHERE id=? AND owner=?', id, owner); if (!row)
    throw new Error('Order not found.'); if (['paid', 'labeling', 'shipped', 'delivered'].includes(row.status))
    return { status: row.status }; const saved = parse<Record<string, any>>(row.data, {}); if (saved.environment !== paymentEnvironment(runtime()))
    throw new Error('This order belongs to another payment environment and requires review.'); if (timestamp() - row.created > 29 * 86400000) {
    await run('UPDATE orders SET status=?,updated=? WHERE id=?', 'review', timestamp(), id);
    throw new Error('This payment is outside the online verification window. Contact Biomod for reconciliation.');
} const result = await createPaymentAdapter(runtime()).verifyPayment({ id, totalCents: row.total, currency: 'USD' }, row.checkout_ref, hints, row.created); if (result.state === 'paid' && (!result.notificationId || !result.providerReference))
    throw new Error('Payment requires review.'); const state = result.state === 'failed' ? 'review' : result.state; const db=database();const written=await db.batch([
 db.prepare(inventorySql.paymentStatus).bind(state,result.state==='paid'?result.providerReference:null,result.notificationId||null,timestamp(),id),
 db.prepare(inventorySql.settleInventory).bind(id,id,id),
 db.prepare(inventorySql.clearSettledReservation).bind(id,id)
]);
// Email the store a full copy of the order the first time it is marked paid (the status update only changes a row once).
if (state === 'paid' && written[0]?.meta?.changes) await sendOrderNotification(runtime(), id, saved);
return { status: state, message: result.state === 'failed' ? 'The payment attempt failed. This order is held for review before inventory is released.' : result.message }; }
