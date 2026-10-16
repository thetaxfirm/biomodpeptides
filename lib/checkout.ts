import { savedBatch } from './batch-snapshot';
import { withAuditDb, auditRun, type AuditActor } from './change-history';
import { unavailableOrder } from './catalog-visibility';
import { releaseUnpaidOrder, RELEASABLE } from './checkout-expiry';
import inventorySql from './inventory-statements.json';
import { sendOrderNotification } from './order-summary';
import { quote, CartLine } from './commerce';
import { one, run, uid, timestamp, runtime, parse, database } from './runtime';
import { createPaymentAdapter, paymentEnvironment, paymentReturnUrl } from './payments';
import { checkoutTax } from './checkout-tax';
import { savedPreorder } from './fulfillment';
import { z } from 'zod';
import { customer } from './auth';
import { carrierShippingOptions, easypostReady } from './easypost';
import { normalizeShippingOptions, savedShippingOption, shippingTierEnabled, enabledServiceSetting, type ShippingOption, type ShippingOptionsConfig } from './shipping-options';
/** A quoted option is still payable only if the owner's current settings would produce the same charge. */
function optionStillOffered(saved: ShippingOption, settings: ShippingOptionsConfig, freeStandard: boolean) {
    if (!shippingTierEnabled(settings, saved.tier) || (saved.carrier && !settings.carriers.includes(saved.carrier))) return false;
    if (!settings.services) return saved.free === (saved.tier === 'standard' && freeStandard);
    if (saved.free && !(saved.tier === 'standard' && freeStandard)) return false;
    if (saved.source === 'flat') return true;
    const chosen = saved.serviceKey ? enabledServiceSetting(settings, saved.serviceKey) : null;
    return Boolean(chosen && chosen.markupCents === saved.handlingCents);
}
export const addressSchema = z.object({ name: z.string().trim().min(2).max(100), line1: z.string().trim().min(3).max(150), line2: z.string().trim().max(150).default(''), city: z.string().trim().min(2).max(100), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Enter a two-letter state abbreviation, such as NV.'), zip: z.string().regex(/^\d{5}(-\d{4})?$/), country: z.literal('US'), phone: z.string().trim().min(7).max(30) });
const QUOTE_LIFETIME = 600000;
type ShippingPreset = { shipping: number; shippingService: string; shippingOption?: ShippingOption; shippingOptions?: ShippingOption[] };
const quoteExpired = (created: number) => !Number.isFinite(created) || timestamp() - created < 0 || timestamp() - created > QUOTE_LIFETIME;
/** Rates are requested once; changing the selection reuses the stored options and their original expiry. */
export async function deliveryQuote(lines: CartLine[], raw: unknown, preset?: ShippingPreset, promoCode?: unknown) {
    const address = addressSchema.parse(raw);
    const q = await quote(lines, promoCode);
    if (!lines.length) throw new Error('Your cart is empty.');
    const settings = normalizeShippingOptions(q.config.shippingOptions, runtime());
    const freeStandard = settings.freeStandardEnabled && q.total >= q.config.freeShippingAt;
    let shippingOption: ShippingOption | undefined;
    let shippingOptions: ShippingOption[] = [];
    let shipping: number;
    let shippingService: string;
    if (preset) {
        if (!Number.isSafeInteger(preset.shipping) || preset.shipping < 0) throw new Error('Your shipping quote is invalid. Recalculate delivery.');
        if (preset.shippingOption) {
            const saved = savedShippingOption(preset.shippingOption);
            if (!saved || !optionStillOffered(saved, settings, freeStandard)) throw new Error('Your shipping options changed. Recalculate delivery.');
            shippingOption = saved;
            shippingOptions = preset.shippingOptions || [saved];
            shipping = saved.shipping;
            shippingService = saved.shippingService;
        } else {
            // Compatibility for pre-release stored quotes and internal callers. Never take this preset from the client.
            shipping = preset.shipping;
            shippingService = preset.shippingService || 'Standard shipping';
        }
    } else {
        if (easypostReady(runtime()) && settings.carriers.length && (settings.standardEnabled || settings.expeditedEnabled || settings.overnightEnabled)) {
            try { shippingOptions = await carrierShippingOptions(runtime(), address, q.items as any, settings, freeStandard); }
            catch { console.error('Live shipping rates are unavailable; checking configured standard fallback.'); }
        }
        // Flat-rate fallback is Standard only, never a substitute for an overnight quote.
        if (settings.standardEnabled && !shippingOptions.some(o => o.tier === 'standard') && (freeStandard || (Number.isSafeInteger(q.config.shippingCents) && q.config.shippingCents! >= 0))) {
            shippingOptions.unshift({ id: 'flat_standard', tier: 'standard', shippingService: freeStandard ? 'Free standard shipping' : 'Standard shipping', shipping: freeStandard ? 0 : q.config.shippingCents!, carrierCents: null, handlingCents: 0, days: null, carrier: null, carrierService: null, source: 'flat', free: freeStandard });
        }
        shippingOption = shippingOptions[0];
        if (!shippingOption) throw new Error('No enabled delivery option is available for this address. Please contact us for help.');
        shipping = shippingOption.shipping;
        shippingService = shippingOption.shippingService;
    }
    const tax = await checkoutTax(runtime(), address, q.total, shipping);
    return { items: q.items, subtotal: q.subtotal, discount: q.discount, packDiscount: q.packDiscount, promoDiscount: q.promoDiscount, promo: q.promo, shipping, shippingService, shippingOption, shippingOptionId: shippingOption?.id, shippingOptions, tax, total: q.total + shipping + tax, address };
}
const fingerprintItems = (q: Record<string, any>) => q.items.map((i: any) => ({ id: i.id, quantity: i.quantity, packId: i.packId || null, packSize: i.packSize || null, packKind: i.packKind || null, lineTotal: i.lineTotal, presaleId: i.presaleId || null, price: i.product.price, preorder: savedPreorder(i.product.activePreorder), batch: savedBatch(i.product.soldBatch) }));
export const quoteFingerprint = (q: Record<string, any>) => JSON.stringify({ items: fingerprintItems(q), address: q.address, shipping: q.shipping, shippingService: q.shippingService || '', shippingOption: savedShippingOption(q.shippingOption), tax: q.tax, total: q.total, ...(q.promo ? { promoCode: q.promo.code } : {}) });
const inputFingerprint = (q: Record<string, any>) => JSON.stringify({ items: fingerprintItems(q), address: q.address, subtotal: q.subtotal, discount: q.discount, ...(q.promo ? { promoCode: q.promo.code } : {}) });
export async function issueQuote(owner: string, lines: CartLine[], address: unknown, promoCode?: unknown, selection?: { quoteId: string; shippingOptionId: string }) {
    let created = timestamp();
    let preset: ShippingPreset | undefined;
    let expectedInput: string | undefined;
    if (selection) {
        const receipt = await one<{ data: string; created: number }>('SELECT data,created FROM requests WHERE id=? AND owner=? AND kind=?', selection.quoteId, owner, 'quote');
        if (!receipt || quoteExpired(receipt.created)) throw new Error('Your checkout quote expired. Recalculate delivery.');
        const stored = parse<Record<string, any>>(receipt.data, {});
        const options = Array.isArray(stored.shippingOptions) ? stored.shippingOptions.map(savedShippingOption).filter((o: ShippingOption | null): o is ShippingOption => o !== null) : [];
        const option = options.find((o: ShippingOption) => o.id === selection.shippingOptionId);
        if (!option || typeof stored.inputFingerprint !== 'string') throw new Error('Choose an available shipping option from a new delivery quote.');
        preset = { shipping: option.shipping, shippingService: option.shippingService, shippingOption: option, shippingOptions: options };
        expectedInput = stored.inputFingerprint;
        created = receipt.created;
    }
    const q = await deliveryQuote(lines, address, preset, promoCode);
    if (expectedInput !== undefined && expectedInput !== inputFingerprint(q)) throw new Error('Your cart, address or promotion changed. Recalculate delivery.');
    const id = uid();
    await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, owner, 'quote', JSON.stringify({ fingerprint: quoteFingerprint(q), inputFingerprint: inputFingerprint(q), shipping: q.shipping, shippingService: q.shippingService, shippingOption: q.shippingOption, shippingOptionId: q.shippingOptionId, shippingOptions: q.shippingOptions }), created);
    return { ...q, quoteId: id, quoteExpiresAt: created + QUOTE_LIFETIME };
}
export async function checkout(owner: string, lines: CartLine[], body: Record<string, any>, promoCode?: unknown) {
    const auditActor: AuditActor = { source: 'system', actor: 'Website checkout', actorType: 'system', action: 'checkout.state' };
    const run = (sql: string, ...values: (string | number | null)[]) => auditRun(database(), auditActor, sql, ...values);
    if (body.accepted !== true)
        throw new Error('Confirm that you are 21 or older and purchasing for laboratory research only.');
    if (typeof body.requestKey !== 'string' || !/^[a-f0-9-]{36}$/.test(body.requestKey))
        throw new Error('Refresh checkout and try again.');
    // Private snapshot stays only in this request. Any product/lot/COA write
    // during quote validation must abort the reservation before payment starts.
    const productRows = (await database().prepare('SELECT id,data FROM product_overrides').all<{ id: number; data: string }>()).results;
    const productVersions = [...new Set(lines.map(line => line.id))].map(productId => ({ id: productId, data: productRows.find(row => row.id === productId)?.data ?? null, guard: uid() }));
    const cartQuote = await quote(lines, promoCode);
    const current = addressSchema.parse(body.address);
    const fingerprint = JSON.stringify({ lines, address: current, ...(cartQuote.promo ? { promoCode: cartQuote.promo.code } : {}), ...(typeof body.shippingOptionId === 'string' ? { shippingOptionId: body.shippingOptionId } : {}) });
    // An earlier unresolved checkout blocks this one, because two live payment attempts for one
    // customer is how somebody gets charged twice. An abandoned attempt is a different thing, and it
    // used to block just as hard and forever: the customer could resume or verify that order, never
    // clear it, so wanting anything else meant contacting us. Here each blocker is examined in turn.
    // An exact repeat hands back the original order. Anything else is offered to the provider, and
    // only a verified "no payment exists" releases it and frees its stock so this order can proceed.
    // A real payment, a pending one, or an order held for review still blocks, exactly as before.
    for (let attempt = 0; attempt < 5; attempt++) {
        const old = await one<{
            id: string;
            status: string;
            checkout_url: string;
            data: string;
            total: number;
            checkout_ref: string;
            created: number;
            payment_ref: string | null;
            notification_id: string | null;
        }>('SELECT id,status,checkout_url,data,total,checkout_ref,created,payment_ref,notification_id FROM orders WHERE owner=? AND (request_key=? OR status IN (?,?,?,?)) ORDER BY created DESC LIMIT 1', owner, body.requestKey, 'creating', 'awaiting_payment', 'pending', 'review');
        if (!old) break;
        const saved = parse<Record<string, any>>(old.data, {});
        if (unavailableOrder(saved)) throw new Error('This order contains an unavailable product and requires review.');
        if (saved.environment !== paymentEnvironment(runtime()))
            throw new Error('An existing payment requires review before a new checkout can begin.');
        if (old.checkout_url && ['awaiting_payment', 'pending'].includes(old.status) && saved.fingerprint === fingerprint && saved.total === body.expectedTotal)
            return { id: old.id, url: old.checkout_url };
        const releasable = RELEASABLE.includes(old.status) && await releaseUnpaidOrder(withAuditDb(database(), auditActor), createPaymentAdapter(runtime()).verifyPayment, old, timestamp()).catch(() => false);
        if (!releasable) throw new Error('You already have an unresolved checkout. Open your orders to verify payment before placing another order.');
    }
    const adapter = createPaymentAdapter(runtime());
    if (!adapter.getStatus().checkoutEnabled)
        throw new Error('Online payment is being connected. No payment has been taken.');
    const receipt = await one<{
        data: string;
        created: number;
    }>('SELECT data,created FROM requests WHERE id=? AND owner=? AND kind=?', String(body.quoteId || ''), owner, 'quote');
    if (!receipt || quoteExpired(receipt.created)) throw new Error('Your checkout quote changed or expired. Recalculate delivery and review the order again.');
    const quoted = parse<Record<string, any>>(receipt.data, {});
    const selected = savedShippingOption(quoted.shippingOption);
    if (quoted.shippingOption && (!selected || body.shippingOptionId !== selected.id)) throw new Error('Review your selected shipping option and recalculate delivery before paying.');
    if (!quoted.shippingOption && body.shippingOptionId !== undefined) throw new Error('Recalculate delivery to use the current shipping options.');
    if (!Number.isSafeInteger(quoted.shipping) || quoted.shipping < 0) throw new Error('Recalculate delivery before paying.');
    const q = await deliveryQuote(lines, current, { shipping: quoted.shipping, shippingService: String(quoted.shippingService || ''), ...(selected ? { shippingOption: selected } : {}) }, promoCode);
    if (quoted.fingerprint !== quoteFingerprint(q))
        throw new Error('Your checkout quote changed or expired. Recalculate delivery and review the order again.');
    if (!Number.isInteger(body.expectedTotal) || body.expectedTotal !== q.total)
        throw new Error('Your total changed. Recalculate delivery and review the updated total before paying.');
    // No stock count means inventory is not tracked for that product; it never blocks a purchase.
    // The original COA ships with the order or is sent on request.
    const campaignId = lines[0]?.presaleId || null;
    const campaign = campaignId ? parse<Record<string, any>>((await one<{
        data: string;
    }>('SELECT data FROM campaigns WHERE id=?', campaignId))?.data, {}) : null;
    const email = (await customer())?.email || '';
    const { shippingOptions: _unselectedOptions, ...selectedQuote } = q;
    const saved = { ...selectedQuote, email, fingerprint, environment: paymentEnvironment(runtime()), campaignId, campaignLimit: campaign?.maxPerCustomer || null, unitCount: lines.reduce((s, l) => s + l.quantity, 0) };
    const id = uid();
    const db=withAuditDb(database(), auditActor);
    try { await db.batch([
      ...productVersions.map(version => db.prepare(inventorySql.checkProductVersion).bind(version.guard, version.data, version.id)),
      db.prepare(inventorySql.insertOrder).bind(id,owner,body.requestKey,'creating',JSON.stringify(saved),q.total,adapter.reference(id),timestamp(),timestamp()),
      db.prepare(inventorySql.reserve).bind(id),
      db.prepare(inventorySql.checkReservation).bind(id,id,id),
      db.prepare(inventorySql.clearGuard).bind(id),
      ...productVersions.map(version => db.prepare(inventorySql.clearGuard).bind(version.guard))
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
export async function reconcile(owner: string, id: string, hints: string[] = [], auditActor: AuditActor = { source: 'system', actor: 'Payment reconciliation', actorType: 'system', action: 'payment.reconcile' }) {
 const run = (sql: string, ...values: (string | number | null)[]) => auditRun(database(), auditActor, sql, ...values);
 const row = await one<{
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
    throw new Error('Payment requires review.'); const state = result.noPaymentFound ? 'awaiting_payment' : result.state === 'failed' || result.state === 'pending' ? 'review' : result.state; const db=withAuditDb(database(), auditActor);const written=await db.batch([
 db.prepare(inventorySql.paymentStatus + ' AND total=?').bind(state,result.state==='paid'?result.providerReference:null,result.notificationId||null,timestamp(),id,row.total),
 db.prepare(inventorySql.settleInventory).bind(id,id,id),
 db.prepare(inventorySql.clearSettledReservation).bind(id,id)
]);
if (!written[0]?.meta?.changes) {
 const latest=await one<{status:string}>('SELECT status FROM orders WHERE id=? AND owner=?',id,owner);
 if(latest && ['paid','labeling','shipped','delivered'].includes(latest.status))return {status:latest.status};
 throw new Error('The order changed during verification. Check payment status again before paying.');
}
// Email the store a full copy of the order the first time it is marked paid (the status update only changes a row once).
if (state === 'paid' && written[0]?.meta?.changes) await sendOrderNotification(runtime(), id, saved);
return { status: state, message: result.state === 'failed' ? 'The payment attempt failed. This order is held for review before inventory is released.' : result.message }; }
