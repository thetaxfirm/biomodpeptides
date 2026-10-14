import { replyBridgeRoute } from '@/lib/request-reply-route';
import { queryOrders, scanLimit } from '@/lib/order-queue';
import { publicCatalog } from '@/lib/public-catalog';
import { batchRecordsFor, batchStatus, batchPath } from '@/lib/testing';
import { externalRepliesFor, markReplied } from '@/lib/request-external';
import { startOrderConversation, saveRequestIssue, issuesFor, caseLog, setOrderHold, startWinBack, winBackPreview } from '@/lib/request-cases';
import { forwardRequest, forwardsFor, teamMembers, activityFor } from '@/lib/request-forward';
import { summarizeRequestReplies, prepareRequestReply, autoDraftNewRequest, replyDeskOptions, saveReplyRule } from '@/lib/request-replies';
import { adminBatchRecords, validateBatchEdit } from '@/lib/product-batch';
import { coaHash, loadCoaReports, readCoaOriginal, verifiedCoaAttachment } from '@/lib/coa-delivery';
import { changeHistory, auditRun, withAuditDb, recordChange, type AuditActor } from '@/lib/change-history';
import { recoveryAdminStatus } from '@/lib/checkout-recovery';
import { coaAutomationStatus, enqueueCoaRequest, enqueueRequestAlert, processCoaOutbox, saveCoaConfig } from '@/lib/coa-outbox';
import { promoAnalytics } from '@/lib/promo-analytics';
import { PROMO_COOKIE, promotion } from '@/lib/promotions';
import inventorySql from '@/lib/inventory-statements.json';
import { AUTH_RETURN_COOKIE, AUTH_RETURN_MAX_AGE, safeAuthReturn, clearAuthSessionCookies, ANONYMOUS_SESSION_COOKIE, needsAnonymousSession, needsAccountSession } from '@/lib/auth-return';
import { after, NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createCartImports } from '@/lib/cart-import';
import { z } from 'zod';
import { session, customer, requireCustomer, requireStaff, staffRole, authReady, authCall, storeAuth, rateLimit, requestPasswordRecovery } from '@/lib/auth';
import { presentationData } from '@/lib/private-presentation';
import { adminOrderView, currentCart, currentProductId, currentSelection, orderView, unavailableOrder } from '@/lib/catalog-visibility';
import { catalog, config, quote, validateLines } from '@/lib/commerce';
import { availabilityOptions, hasPublicationHold, sourcePublicationHold, blockedReleaseLot } from '@/lib/availability';
import { all, one, run, uid, timestamp, parse, runtime, database } from '@/lib/runtime';
import { checkout, reconcile, addressSchema, issueQuote } from '@/lib/checkout';
import { getPaymentStatus, paymentEnvironment, paymentProvider } from '@/lib/payments';
import { createAnetAdapter } from '@/lib/authorizenet-payments';
import { anetOrderDetails } from '@/lib/order-summary';
import { packSizes, supportsPacks, standardPackPrices } from '@/lib/packs';
import { searchReport, seoConfig } from '@/lib/seo-policy';
import { salesDiagnostics } from '@/lib/sales-diagnostics';
import { can, permissionsFor, type StaffPermission } from '@/lib/staff';
import { saveStaffMember, staffDirectory } from '@/lib/staff-store';
import { coaBlockedItems, coaBlockMessage, noCoaProducts } from '@/lib/coa-shipping';
import { adminOverview } from '@/lib/admin-overview';
export const dynamic = 'force-dynamic';
// What each admin write needs. An admin action missing here requires the owner.
const adminActionPermission: Record<string, StaffPermission> = {
    'admin-order': 'orders:fulfill', 'admin-reconcile': 'orders:reconcile',
    'admin-request': 'requests:write', 'admin-request-reply': 'requests:write', 'admin-reply-desk': 'requests:write', 'admin-request-replies': 'requests:write', 'admin-reply-rule': 'requests:write', 'admin-request-forward': 'requests:write', 'admin-order-conversation': 'requests:write', 'admin-order-hold': 'requests:write', 'admin-win-back': 'requests:write', 'admin-mark-replied': 'requests:write', 'admin-win-back-preview': 'requests:write', 'admin-request-issue': 'requests:write', 'admin-case-log': 'requests:write', 'admin-coa-process': 'requests:write',
    'admin-config': 'store:write', 'admin-product': 'store:write', 'admin-campaign': 'store:write', 'admin-reward': 'store:write', 'admin-coa-config': 'store:write',
    'admin-staff': 'team:manage',
};
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const cartImports = () => createCartImports({ db: database(), normalize: validateLines, validate: quote });
// Start only this newly saved inquiry after the response. Durable jobs remain the
// source of recipients/documents; the outbox keeps its leases, caps and retry policy.
function scheduleInquiryDelivery(env: ReturnType<typeof runtime>, requestId: string, kind: 'contact' | 'affiliate') {
    try {
        const deliveryEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Inquiry delivery automation', actorType: 'system' }) } as ReturnType<typeof runtime>;
        after(async () => {
            await Promise.allSettled([
                autoDraftNewRequest(env, requestId),
                processCoaOutbox(deliveryEnv, { requestId, purpose: 'request-alert', limit: 1 }),
            ]);
        });
    } catch {
        // A missing response lifecycle cannot undo a saved inquiry. The durable
        // queue is still available to the scheduled retry or authorized admin.
    }
}
// Public matching-lot certificate pages, the same ones /testing shows. Links only; no report bytes.
async function publicCoaLinks() {
    try {
        const snapshot = await publicCatalog();
        if (!snapshot.verified) return [];
        return batchRecordsFor(snapshot.products).filter(record => batchStatus(record) === 'matched').map(record => {
            const product = snapshot.products.find(item => item.id === record.product_id);
            return { label: `${product?.name || record.product_name || 'Product'}${product?.sizes?.[0] ? ' ' + product.sizes[0] : ''} · lot ${record.product_lot}`, url: 'https://trybiomod.com' + batchPath(record) };
        }).sort((a, b) => a.label.localeCompare(b.label));
    } catch { return []; }
}
async function currentPromoCode() {
    const jar = await cookies();
    try { return promotion(jar.get(PROMO_COOKIE)?.value)?.code || ''; }
    catch { jar.delete(PROMO_COOKIE); return ''; }
}

const str = (v: unknown, max = 2000) => z.string().trim().min(1).max(max).parse(v);
export async function GET(req: NextRequest, { params }: {
    params: Promise<{
        action: string;
    }>;
}) {
    try {
        const { action } = await params;
        if (action === 'admin-coa-original') {
            try { await requireStaff('store:write'); } catch { return j({ error: 'Administrator product access required.' }, 403); }
            const ref = req.nextUrl.searchParams.get('ref') || '';
            if (!/^private:[a-f0-9]{64}$/.test(ref)) return j({ error: 'Original report not found.' }, 404);
            const report = (await loadCoaReports(database())).find(r => 'private:' + r.sha256 === ref);
            const original = report ? await readCoaOriginal(database(), report) : null;
            if (!original) return j({ error: 'Original report unavailable.' }, 404);
            const attachment = await verifiedCoaAttachment(original);
            return new NextResponse(Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(attachment.filename), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "frame-ancestors 'self'" } });
        }
        if (action === 'admin-changes') {
            try { await requireStaff('reports:read'); } catch { return j({ error: 'Administrator reporting access required.' }, 403); }
            return j(await changeHistory(database(), req.nextUrl.searchParams));
        }
        if (action === 'admin-diagnostics')
            return j(await salesDiagnostics({ requireAdmin: () => requireStaff('reports:read'), all }, req.nextUrl.searchParams.get('days')));
        if (action === 'admin-promos')
            return j(await promoAnalytics({ requireAdmin: () => requireStaff('reports:read'), all }, req.nextUrl.searchParams.get('days')));
        const u = await customer();
        if (action === 'state') {
            const secure = req.nextUrl.protocol === 'https:';
            let s = await session(secure);
            // An expired/revoked login must not expose a previous member's browser cart.
            const stateCookies = await cookies();
            const claimedOwner = await cartImports().ownerForSession(s.id);
            if (needsAnonymousSession(Boolean(u), Boolean(stateCookies.get('bm_access') || stateCookies.get('bm_refresh')), claimedOwner, s.id, stateCookies.get(ANONYMOUS_SESSION_COOKIE)?.value) || (u && claimedOwner && claimedOwner !== u.id)) {
                stateCookies.delete('bm_session');
                s = await session(secure);
                if (!u) stateCookies.set(ANONYMOUS_SESSION_COOKIE, s.id, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 2592000 });
            }
            if (u) {
                // If token refresh recovers after an anonymous fallback, retain items
                // added during that fallback instead of silently loading the old cart.
                if (stateCookies.get(ANONYMOUS_SESSION_COOKIE)?.value === s.id) {
                    await cartImports().record(u.id, s.id);
                    stateCookies.delete(ANONYMOUS_SESSION_COOKIE);
                }
                await cartImports().bindOwner(u.id, s.id);
            }
            const ps = await catalog();
            const cfg = await config();
            const cartConflict = u ? await cartImports().inspect(u.id, s.id) : null;
            if (u)
                await run('INSERT OR IGNORE INTO profiles(id,name,wishlist,created) VALUES(?,?,?,?)', u.id, u.name, JSON.stringify(parse<number[]>(s.wishlist, []).filter(currentProductId)), timestamp());
            if(u)await run('INSERT OR IGNORE INTO customer_carts(id,cart,updated) VALUES(?,?,?)',u.id,JSON.stringify(currentCart(validateLines(parse(s.cart,[])))),timestamp());
            const storedCart = u ? parse((await one<{
                cart: string;
            }>('SELECT cart FROM customer_carts WHERE id=?', u.id))?.cart, []) : parse(s.cart, []);
            const storedWishlist = u ? parse((await one<{
                wishlist: string;
            }>('SELECT wishlist FROM profiles WHERE id=?', u.id))?.wishlist, []) : parse(s.wishlist, []);
            const cart = currentCart(validateLines(storedCart));
            const wishlist = (storedWishlist as number[]).filter(currentProductId);
            const cartChanged = JSON.stringify(cart) !== JSON.stringify(storedCart);
            if (cartChanged) {
                await run('UPDATE sessions SET cart=?,updated=? WHERE id=?', JSON.stringify(cart), timestamp(), s.id);
                if(u) await run('UPDATE customer_carts SET cart=?,updated=? WHERE id=?', JSON.stringify(cart), timestamp(), u.id);
            }
            let totals = null;
            let cartError = '';
            const cartNotice = cartChanged ? 'Unavailable products or packs were removed. Review the remaining items before checkout.' : '';
            try {
                totals = await quote(validateLines(cart), await currentPromoCode());
            }
            catch (e) {
                cartError = (e as Error).message;
            }
            const payment = getPaymentStatus(runtime());
            const role = u ? await staffRole(u.email) : null;
            const packOwner = u ? 'customer:' + u.id : 'guest:' + s.id;
            if(u) await run('UPDATE saved_packs SET owner=? WHERE owner=?',packOwner,'guest:'+s.id);
            const savedPacks = (await all<{id:string;name:string;products:string;updated:number}>('SELECT id,name,products,updated FROM saved_packs WHERE owner=? ORDER BY updated DESC',packOwner)).map(p=>({...p,products:parse(p.products,[])})).filter(p=>currentSelection(p.products)).map(p=>presentationData(p));
            return j({ products: ps, config: cfg, cart, cartConflict, wishlist, savedPacks, customer: u, authReady: authReady(), googleReady: authReady() && runtime().GOOGLE_SIGNIN_ENABLED === 'true', payment: { state: payment.state, enabled: payment.checkoutEnabled }, totals, cartError, cartNotice, campaigns: (await all<{
                    id: string;
                    data: string;
                    active: number;
                }>('SELECT id,data,active FROM campaigns WHERE active=1')).map<Record<string, any>>(c => ({ ...parse<Record<string, any>>(c.data, {}), id: c.id })).filter(c=>currentSelection(c.productIds)).map(c=>presentationData(c)), admin: Boolean(role), staffRole: role, permissions: permissionsFor(role) });
        }
        if (action === 'pay') {
            // Authorize.net Accept Hosted: issue a fresh single-use token and POST the customer to the hosted card form.
            const page = (title: string, body: string, status = 200) => new NextResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + title + '</title><style>body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#f2ede4;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}a,button{color:#0b0b0b;background:#c8a46a;border:0;border-radius:6px;padding:12px 20px;font:inherit;text-decoration:none;cursor:pointer}</style></head><body><main>' + body + '</main></body></html>', { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
            const esc = (v: string) => v.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
            const fail = (message: string, status = 400) => page('Payment unavailable', '<h1>Payment unavailable</h1><p>' + esc(message) + '</p><p><a href="/account/orders">View my orders</a></p>', status);
            if (!u)
                return fail('Please sign in to continue.', 401);
            if (paymentProvider(runtime()) !== 'authorizenet')
                return fail('This checkout is not available.', 404);
            const id = String(req.nextUrl.searchParams.get('id') || '');
            if (!/^[a-f0-9-]{36}$/.test(id))
                return fail('Order not found.', 404);
            const o = await one<{ id: string; status: string; total: number; checkout_ref: string; data: string; created: number }>('SELECT id,status,total,checkout_ref,data,created FROM orders WHERE id=? AND owner=?', id, u.id);
            const saved = parse<{ environment?: string; address?: Record<string, string> } & Record<string, unknown>>(o?.data, {});
            if (!o || unavailableOrder(saved) || !['awaiting_payment', 'pending'].includes(o.status) || saved.environment !== paymentEnvironment(runtime()) || timestamp() - o.created > 7 * 86400000)
                return fail('This payment requires review. Open your orders or contact us before paying again.');
            const adapter = createAnetAdapter(runtime());
            const order = { id: o.id, totalCents: o.total, currency: 'USD' as const };
            try {
                // Never offer a second payment form once Authorize.net shows a capture or a transaction under review.
                const existing = await adapter.verifyPayment(order, o.checkout_ref, [], o.created);
                if (existing.state === 'paid')
                    return page('Payment received', '<h1>Payment received</h1><p>We already have a payment for this order.</p><p><a href="/payment/return">Check payment status</a></p>');
                if (existing.state === 'review' || existing.underReview)
                    return fail('This payment is being reviewed. Please do not pay again. Contact us with order ' + o.id.slice(0, 8) + '.');
                if (saved.internalTest === true) return fail('This is an internal test order.');
                const locked = await run("UPDATE orders SET data=?,updated=? WHERE id=? AND data=? AND total=? AND status IN ('awaiting_payment','pending')", JSON.stringify({...saved,lastPaymentFormAt:timestamp()}),timestamp(),o.id,o.data,o.total);
                if (!locked.meta.changes) return fail('The order changed. Review your current total in My orders before paying.');
                const form = await adapter.hostedForm(order, { email: u.email, customerId: u.id, ...saved.address }, anetOrderDetails(saved));
                return page('Secure payment', '<h1>Opening secure payment…</h1><form id="pay" method="post" action="' + esc(form.action) + '"><input type="hidden" name="token" value="' + esc(form.token) + '"><button type="submit">Continue to secure payment</button></form><script>document.getElementById("pay").submit()</script>');
            }
            catch (e) {
                // Log and show the provider's error code (never credentials) so setup problems can be diagnosed.
                const detail = e instanceof Error && e.name === 'AnetPaymentError' ? ' ' + e.message : '';
                console.error('Authorize.net hosted form failed:', e instanceof Error ? e.name + ': ' + e.message : 'unknown error');
                return fail('The payment page could not be opened. We could not confirm the payment status. Check your orders or contact Biomod before paying again.' + detail, 502);
            }
        }
        if (action === 'account') {
            const user = await requireCustomer();
            return j({ profile: await one('SELECT name,phone,company,research_accepted FROM profiles WHERE id=?', user.id), addresses: (await all<{
                    id: string;
                    data: string;
                }>('SELECT id,data FROM addresses WHERE owner=? ORDER BY created DESC', user.id)).map(a => ({ id: a.id, ...parse(a.data, {}) })), orders: (await all<{
                    data: string;
                }>('SELECT id,status,total,data,created FROM orders WHERE owner=? ORDER BY created DESC LIMIT 100', user.id)).map(o => ({ ...o, data: orderView(parse(o.data, {})) })), requests: (await all<{
                    data: string;
                }>('SELECT id,kind,data,status,created FROM requests WHERE owner=? AND kind IN (\'contact\',\'stock\',\'affiliate\') ORDER BY created DESC LIMIT 100', user.id)).map(r => ({ ...r, data: presentationData(parse(r.data, {})) })), rewards: presentationData(await all('SELECT points,reason,created FROM rewards WHERE owner=? ORDER BY created DESC LIMIT 100', user.id)) });
        }
        if (action === 'admin-overview') {
            // "Today" home: work waiting now, sales and setup gaps. Each section is limited to what the role may see.
            const { role } = await requireStaff('orders:read');
            const allowed = (permission: StaffPermission) => can(role, permission);
            const rows = (await all<{ id: string; status: string; total: number; data: string; created: number; payment_ref: string | null; notification_id: string | null }>('SELECT id,status,total,data,created,payment_ref,notification_id FROM orders ORDER BY created DESC LIMIT ?', scanLimit)).map(o => ({ ...o, data: parse<Record<string, any>>(o.data, {}) }));
            const store = await config();
            return j(await adminOverview(runtime() as any, { orders: rows, products: await catalog(false, true), shipping: store.shippingOptions, environment: paymentEnvironment(runtime()),
                access: { orders: true, requests: allowed('requests:write'), reports: allowed('reports:read'), store: allowed('store:write') } }));
        }
        if (action === 'admin-orders') {
            // Paged, searchable order queue. Counts cover the whole scanned history, not just one page.
            await requireStaff('orders:read');
            const p = req.nextUrl.searchParams;
            const rows = (await all<{ id: string; owner: string; status: string; total: number; data: string; created: number }>('SELECT id,owner,status,total,data,created FROM orders ORDER BY created DESC LIMIT ?', scanLimit + 1)).map(o => ({ ...o, data: adminOrderView(parse(o.data, {})) }));
            const result = queryOrders(rows, { tab: p.get('tab'), q: p.get('q'), offset: p.get('offset'), id: p.get('id') });
            // Products without a COA for the current lot cannot be mailed; flag waiting orders and list the products.
            const products = await catalog(false, true);
            const waiting = rows.filter(o => o.status === 'paid' && !o.data?.shipment).map(o => ({ items: o.data?.items }));
            return j({ ...result, orders: result.orders.map((o: any) => ({ ...o, coaMissing: ['paid', 'labeling'].includes(o.status) && !o.data?.shipment ? coaBlockedItems(o.data?.items, products) : [] })), noCoa: noCoaProducts(products, waiting) });
        }
        if (action === 'admin') {
            // Every role sees orders; other sections are sent only to roles that hold them.
            const { role } = await requireStaff('orders:read');
            const allowed = (permission: StaffPermission) => can(role, permission);
            const requests = allowed('requests:write') ? await all<{ id: string; data: string }>("SELECT * FROM requests WHERE kind IN ('contact','stock','affiliate') ORDER BY created DESC LIMIT 200") : [];
            const adminProducts = await catalog(false, allowed('store:write'));
            return j({ role, permissions: permissionsFor(role), batchRecords: allowed('store:write') ? await adminBatchRecords(database(), adminProducts) : [], checkoutRecovery: await recoveryAdminStatus(runtime()), searchPublishing: allowed('reports:read') ? searchReport(seoConfig(runtime())) : null, config: await config(), products: adminProducts, orders: (await all<{
                    data: string;
                }>('SELECT id,owner,status,total,data,created FROM orders ORDER BY created DESC LIMIT 200')).map(o => ({ ...o, data: adminOrderView(parse(o.data, {})) })), requests: requests.map(o => ({ ...o, data: parse(o.data, {}) })), requestReplies: allowed('requests:write') ? await summarizeRequestReplies(runtime(), requests.map(r => r.id)) : {}, coaAutomation: allowed('requests:write') ? await coaAutomationStatus(runtime(), requests.map(r => r.id)) : null, campaigns: allowed('store:write') ? (await all<{
                    data: string;
                }>('SELECT * FROM campaigns')).map<Record<string, any>>(o => { const {data, ...row}=o; return { ...row, ...parse<Record<string, any>>(data, {}) }; }).filter(c=>currentSelection(c.productIds)).map(c=>presentationData(c)) : [], team: allowed('team:manage') ? await staffDirectory(runtime()) : null });
        }
        return j({ error: 'Not found.' }, 404);
    }
    catch (e) {
        return j({ error: (e as Error).message }, 400);
    }
}
export async function POST(req: NextRequest, { params }: {
    params: Promise<{
        action: string;
    }>;
}) {
    try {
        const { action } = await params;
        if (action === 'reply-bridge') return replyBridgeRoute(req, runtime());
        if (req.headers.get('origin') !== req.nextUrl.origin)
            return j({ error: 'Please refresh the page and try again.' }, 403);
        if (Number(req.headers.get('content-length') || 0) > 30000)
            return j({ error: 'Request too large.' }, 413);
        const reader = req.body?.getReader();
        let raw = '';
        let bytes = 0;
        if (reader) {
            const decoder = new TextDecoder();
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > 30000) {
                    await reader.cancel();
                    return j({ error: 'Request too large.' }, 413);
                }
                raw += decoder.decode(part.value, { stream: true });
            }
            raw += decoder.decode();
        }
        if (raw.length > 30000)
            return j({ error: 'Request too large.' }, 413);
        const b = JSON.parse(raw);
        if (!b || typeof b !== 'object' || Array.isArray(b) || !req.headers.get('content-type')?.includes('application/json'))
            return j({ error: 'A JSON object is required.' }, 400);
        const secure = req.nextUrl.protocol === 'https:';
        const s = await session(secure);
        await rateLimit(action + ':' + (req.headers.get('cf-connecting-ip') || s.id), action.startsWith('auth') ? 12 : 120);
        if (action === 'saved-pack') {
            const u = await customer(); const owner = u ? 'customer:'+u.id : 'guest:'+s.id;
            const id = b.id === undefined ? uid() : z.string().uuid().parse(b.id);
            if(b.remove===true){await run('DELETE FROM saved_packs WHERE id=? AND owner=?',id,owner);return j({ok:true});}
            const name = str(b.name,60); const ids = z.array(z.number().int().positive()).max(10).parse(b.products);
            const ps = await catalog();
            if(!packSizes.includes(ids.length as any)||ids.some(id=>!ps.some(p=>p.id===id&&supportsPacks(p)))) throw new Error('Save a complete 1, 3, 5, or 10-product pack.');
            if(b.id){const result=await run('UPDATE saved_packs SET name=?,products=?,updated=? WHERE id=? AND owner=?',name,JSON.stringify(ids),timestamp(),id,owner);if(!result.meta.changes) return j({error:'Saved pack not found.'},404);}
            else {const result=await run('INSERT INTO saved_packs(id,owner,name,products,updated) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM saved_packs WHERE owner=?) < 30',id,owner,name,JSON.stringify(ids),timestamp(),owner);if(!result.meta.changes) throw new Error('You can save up to 30 packs. Remove one before saving another.');}
            return j({id,message:'Pack saved.'});
        }
        if (action === 'cart-choice') {
            const u = await requireCustomer();
            await cartImports().choose(u.id, s.id, z.string().uuid().parse(b.id), str(b.revision, 64), str(b.choice, 20));
            return j({ message: 'Your selected cart is ready for review.' });
        }
        if (action === 'promo') {
            const u = await customer();
            if (u) { await cartImports().bindOwner(u.id, s.id); await cartImports().assertResolved(u.id, s.id); }
            const stored = u ? (await one<{ cart: string }>('SELECT cart FROM customer_carts WHERE id=?', u.id))?.cart : s.cart;
            const lines = currentCart(validateLines(parse(stored, [])));
            const selected = promotion(b.code);
            const jar = await cookies();
            // Removal must work even when a cart item has become unavailable.
            if (!selected) { jar.delete(PROMO_COOKIE); return j({ ok: true, promo: null }); }
            if (!lines.length) throw new Error('Add a product to your cart before applying a promo code.');
            const totals = await quote(lines, selected.code);
            jar.set(PROMO_COOKIE, selected.code, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 2592000 });
            return j({ ok: true, totals, promo: totals.promo });
        }
        if (action === 'cart') {
            const u = await customer();
            if (u) { await cartImports().bindOwner(u.id, s.id); await cartImports().assertResolved(u.id, s.id); }
            const lines = validateLines(b.cart);
            const totals = await quote(lines, await currentPromoCode());
            if (u) {
                await database().batch([
                    database().prepare('UPDATE sessions SET cart=?,updated=? WHERE id=?').bind(JSON.stringify(lines), timestamp(), s.id),
                    database().prepare('INSERT INTO customer_carts(id,cart,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET cart=excluded.cart,updated=excluded.updated').bind(u.id, JSON.stringify(lines), timestamp()),
                ]);
            } else await cartImports().saveGuest(s.id, lines);
            return j({ cart: lines, totals });
        }
        if (action === 'wishlist') {
            const ids = z.array(z.number().int()).max(100).parse(b.ids);
            const ps = await catalog();
            if (ids.some(id => !ps.some(p => p.id === id)))
                throw new Error('Product not found.');
            const u = await customer();
            if (u)
                await run('INSERT INTO profiles(id,wishlist,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET wishlist=excluded.wishlist', u.id, JSON.stringify([...new Set(ids)]), timestamp());
            else
                await run('UPDATE sessions SET wishlist=?,updated=? WHERE id=?', JSON.stringify([...new Set(ids)]), timestamp(), s.id);
            return j({ ok: true });
        }
        if (action === 'auth-login') {
            const prior = await customer();
            const d = await authCall('token?grant_type=password', { email: z.string().email().parse(b.email), password: z.string().min(1).max(200).parse(b.password) });
            const c = await cookies();
            // A direct account switch must not carry the previous member's browser cart.
            const claimedOwner = await cartImports().ownerForSession(s.id);
            const switchingAccount = needsAccountSession(prior?.id, d.user?.id, claimedOwner, Boolean(c.get('bm_access') || c.get('bm_refresh')), s.id, c.get(ANONYMOUS_SESSION_COOKIE)?.value);
            if (switchingAccount) c.delete('bm_session');
            const loginSession = switchingAccount ? await session(secure) : s;
            if (typeof d.user?.id !== 'string') throw new Error('Please sign in again.');
            await cartImports().record(d.user.id, loginSession.id);
            await storeAuth(d, secure);
            c.delete(ANONYMOUS_SESSION_COOKIE);
            const returnTo = safeAuthReturn(b.returnTo ?? c.get(AUTH_RETURN_COOKIE)?.value);
            c.delete(AUTH_RETURN_COOKIE);
            return j({ returnTo });
        }
        if (action === 'auth-register') {
            const name = str(b.name, 100);
            const email = z.string().email().parse(b.email);
            const password = z.string().min(8).max(200).parse(b.password);
            const phone = z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, 'Enter a valid phone number.').parse(b.phone);
            const company = str(b.company, 150);
            const businessType = z.enum(['university', 'researcher', 'laboratory', 'medical_professional', 'other'], { errorMap: () => ({ message: 'Choose your type of business.' }) }).parse(b.businessType);
            if (password !== b.confirmPassword)
                throw new Error('Passwords do not match.');
            // Supabase sends the verification email; unverified members cannot sign in (see customer() in lib/auth.ts).
            const d = await authCall('signup?redirect_to=' + encodeURIComponent(req.nextUrl.origin + '/login'), { email, password, data: { name, company, phone, business_type: businessType } });
            (await cookies()).set(AUTH_RETURN_COOKIE, safeAuthReturn(b.returnTo), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: AUTH_RETURN_MAX_AGE });
            return j({ message: 'Almost done. Check your email and click the link to verify your membership, then sign in.', verificationRequired: true });
        }
        if (action === 'auth-recover') {
            await requestPasswordRecovery(z.string().trim().email().parse(b.email), req.nextUrl.origin);
            (await cookies()).set(AUTH_RETURN_COOKIE, safeAuthReturn(b.returnTo), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: AUTH_RETURN_MAX_AGE });
            return j({ message: 'If this address is eligible, check your email for a secure password link.' });
        }
        if (action === 'auth-reset') {
            const token = str(b.token, 5000);
            const password = z.string().min(8).max(200).parse(b.password);
            if (password !== b.confirmPassword)
                throw new Error('Passwords do not match.');
            await authCall('user', { password }, token);
            return j({ message: 'Your password has been updated. Sign in to continue.' });
        }
        if (action === 'auth-refresh') {
            const token = (await cookies()).get('bm_refresh')?.value;
            if (!token)
                return j({ ok: true });
            const d = await authCall('token?grant_type=refresh_token', { refresh_token: token });
            await storeAuth(d, secure);
            return j({ ok: true });
        }
        if (action === 'auth-logout') {
            const c = await cookies();
            clearAuthSessionCookies(c);
            return j({ ok: true });
        }
        if (action === 'contact') {
            const data = { name: str(b.name, 100), email: z.string().email().parse(b.email), subject: str(b.subject, 150), message: str(b.message, 5000) };
            if (b.website)
                return j({ ok: true });
            const u = await customer();
            const id = uid();
            await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, u?.id || null, 'contact', JSON.stringify(data), timestamp());
            // The saved inquiry remains successful if mail setup or enqueueing is unavailable.
            await Promise.allSettled([enqueueCoaRequest(runtime(), id), enqueueRequestAlert(runtime(), id)]);
            scheduleInquiryDelivery(runtime(), id, 'contact');
            return j({ message: 'Your message has been saved for the Biomod team.', id });
        }
        if (action === 'notify') {
            const id = z.number().int().parse(b.id);
            if (!(await catalog()).some(p => p.id === id))
                throw new Error('Product not found.');
            const u = await requireCustomer();
            const existing = await one('SELECT id FROM requests WHERE owner=? AND kind=? AND json_extract(data,\'$.productId\')=? AND status=?', u.id, 'stock', id, 'new');
            if (!existing)
                await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', uid(), u.id, 'stock', JSON.stringify({ productId: id, email: u.email }), timestamp());
            return j({ message: 'Your restock request has been saved.' });
        }
        if (action === 'profile') {
            const u = await requireCustomer();
            await run('INSERT INTO profiles(id,name,phone,company,research_accepted,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,company=excluded.company,research_accepted=excluded.research_accepted', u.id, str(b.name, 100), str(b.phone, 30), str(b.company, 150), b.accepted ? 1 : 0, timestamp());
            return j({ message: 'Profile saved.' });
        }
        if (action === 'address') {
            const u = await requireCustomer();
            if (b.remove) {
                await run('DELETE FROM addresses WHERE id=? AND owner=?', str(b.id, 50), u.id);
                return j({ ok: true });
            }
            const data = addressSchema.parse(b);
            const id = typeof b.id === 'string' ? b.id : uid();
            if (b.id) {
                await run('UPDATE addresses SET data=? WHERE id=? AND owner=?', JSON.stringify(data), id, u.id);
            }
            else
                await run('INSERT INTO addresses(id,owner,data,created) VALUES(?,?,?,?)', id, u.id, JSON.stringify(data), timestamp());
            return j({ message: 'Address saved.' });
        }
        if (action === 'affiliate') {
            const u = await requireCustomer();
            const id = uid();
            await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, u.id, 'affiliate', JSON.stringify({ email: u.email, website: str(b.website, 500), message: str(b.message, 3000) }), timestamp());
            await Promise.allSettled([enqueueRequestAlert(runtime(), id)]);
            scheduleInquiryDelivery(runtime(), id, 'affiliate');
            return j({ message: 'Your partner application has been saved.' });
        }
        if (action === 'delivery') {
            const u = await requireCustomer();
            // A choice refers only to a rate in this customer's stored quote.
            // Both identifiers are required together; client prices are never accepted.
            const selection = b.quoteId !== undefined || b.shippingOptionId !== undefined
                ? z.object({ quoteId: z.string().uuid(), shippingOptionId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).parse({ quoteId: b.quoteId, shippingOptionId: b.shippingOptionId })
                : undefined;
            await cartImports().assertResolved(u.id, s.id);
            return j(await issueQuote(u.id, validateLines(parse((await one<{
                cart: string;
            }>('SELECT cart FROM customer_carts WHERE id=?', u.id))?.cart, [])), b.address, await currentPromoCode(), selection));
        }
        if (action === 'checkout') {
            const u = await requireCustomer();
            await cartImports().assertResolved(u.id, s.id);
            return j(await checkout(u.id, validateLines(parse((await one<{
                cart: string;
            }>('SELECT cart FROM customer_carts WHERE id=?', u.id))?.cart, [])), b, await currentPromoCode()));
        }
        if (action === 'resume') {
            const u = await requireCustomer();
            const o = await one<{
                checkout_url: string;
                status: string;
                data: string;
            }>('SELECT checkout_url,status,data FROM orders WHERE id=? AND owner=?', str(b.id, 50), u.id);
            if (!o || unavailableOrder(parse(o.data, {})) || !o.checkout_url || !['awaiting_payment', 'pending'].includes(o.status) || parse<Record<string, any>>(o.data, {}).environment !== paymentEnvironment(runtime()))
                throw new Error('This payment requires review.');
            return j({ url: o.checkout_url });
        }
        if (action === 'reconcile') {
            const u = await requireCustomer();
            return j(await reconcile(u.id, str(b.id, 50)));
        }
        if (action.startsWith('admin-')) {
            const actor = await requireStaff(adminActionPermission[action] || 'team:manage');
            const auditActor: AuditActor = { source: 'admin', actor: actor.email, actorType: 'staff', action };
            const auditEnv = () => ({ ...runtime(), DB: withAuditDb(database(), auditActor) } as ReturnType<typeof runtime>);
            const run = (sql: string, ...values: (string | number | null)[]) => auditRun(database(), auditActor, sql, ...values);
            if (action === 'admin-staff') {
                const member = z.object({ email: z.string().trim().min(3).max(254), name: z.string().trim().max(100).optional(), role: z.enum(['manager', 'fulfillment', 'support']), active: z.boolean() }).parse(b);
                return j(await saveStaffMember(auditEnv(), actor.email, member));
            }
            if (action === 'admin-coa-config') {
                const settings = z.object({ enabled: z.boolean(), replyTo: z.string().email(), notifyTo: z.string().email().nullable().optional() }).parse(b);
                await saveCoaConfig(auditEnv(), settings);
                return j({ message: 'COA email settings saved.' });
            }
            if (action === 'admin-request-reply') {
                const input = z.object({ id: z.string().uuid(), mode: z.enum(['ai', 'staff']), body: z.string().max(12000).optional(), instruction: z.string().max(2000).optional(), expectedRevision: z.number().int().positive().nullable(), coaSha256: z.string().max(330).nullable().optional(), send: z.boolean().optional() }).parse(b);
                try {
                    const reply = await prepareRequestReply(runtime(), { ...input, requestId: input.id }, actor);
                    return j({ reply, message: input.send ? 'Sending from research@biomodpeptides.com through Jarvis.' : input.mode === 'ai' ? 'AI is writing the draft.' : 'Draft saved. Nothing was sent.' });
                } catch (error) {
                    const status = (error as Error & { status?: number }).status;
                    return j({ error: status ? (error as Error).message : 'The reply could not be prepared. Refresh and try again.' }, status || 500);
                }
            }
            if (action === 'admin-reply-desk') return j({ ...(await replyDeskOptions(runtime())), links: await publicCoaLinks(), team: await teamMembers(runtime()) });
            if (action === 'admin-request-replies') {
                const ids = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(b).ids;
                return j({ replies: await summarizeRequestReplies(runtime(), ids), forwards: await forwardsFor(runtime(), ids), activity: await activityFor(runtime(), ids), issues: await issuesFor(runtime(), ids), external: await externalRepliesFor(runtime(), ids) });
            }
            if (action === 'admin-order-conversation') {
                const input = z.object({ orderId: z.string().min(6).max(80) }).parse(b);
                try { const result = await startOrderConversation(runtime(), input.orderId, actor); return j({ ...result, message: result.created ? 'Conversation started. Nothing was sent.' : 'Opened the existing conversation for this order.' }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not open a conversation for this order.' }, status || 500); }
            }
            if (action === 'admin-order-hold') {
                const input = z.object({ orderId: z.string().min(6).max(80), issue: z.string().max(40).optional(), note: z.string().max(500).optional(), clear: z.boolean().optional() }).parse(b);
                try {
                    if (input.clear) { await setOrderHold(runtime(), input.orderId, null, actor); return j({ message: 'Hold cleared. The order can ship again.' }); }
                    const hold = await setOrderHold(runtime(), input.orderId, { issue: input.issue || '', note: input.note }, actor);
                    const conversation = await startOrderConversation(runtime(), input.orderId, actor);
                    const known = (await issuesFor(runtime(), [conversation.requestId]))[conversation.requestId];
                    await saveRequestIssue(runtime(), { requestId: conversation.requestId, issue: hold!.issue, resolutions: known?.resolutions || [], note: hold!.note || known?.note || '' }, actor);
                    return j({ hold, requestId: conversation.requestId, message: 'Order on hold. Nothing was sent to the customer.' });
                } catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not update the hold.' }, status || 500); }
            }
            if (action === 'admin-mark-replied') {
                const input = z.object({ id: z.string().uuid(), note: z.string().max(1000).optional() }).parse(b);
                try { return j({ reply: await markReplied(runtime(), { requestId: input.id, note: input.note }, actor), message: 'Marked as replied.' }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not mark it.' }, status || 500); }
            }
            if (action === 'admin-win-back') {
                const input = z.object({ orderId: z.string().min(6).max(80), template: z.string().max(40) }).parse(b);
                try { return j({ ...(await startWinBack(runtime(), input.orderId, input.template, actor)), message: 'Draft ready in Requests. Nothing was sent.' }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not prepare the email.' }, status || 500); }
            }
            if (action === 'admin-win-back-preview') {
                const input = z.object({ id: z.string().uuid() }).parse(b);
                try { return j({ templates: await winBackPreview(runtime(), input.id) }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Templates unavailable.' }, status || 500); }
            }
            if (action === 'admin-request-issue') {
                const input = z.object({ id: z.string().uuid(), issue: z.string().max(40), resolutions: z.array(z.string().max(40)).max(10).optional(), note: z.string().max(1000).optional() }).parse(b);
                try { return j({ issue: await saveRequestIssue(runtime(), { requestId: input.id, issue: input.issue, resolutions: input.resolutions, note: input.note }, actor) }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not save the issue.' }, status || 500); }
            }
            if (action === 'admin-case-log') return j({ cases: await caseLog(runtime()) });
            if (action === 'admin-request-forward') {
                const input = z.object({ id: z.string().uuid(), to: z.string().email().max(254), note: z.string().max(2000).optional() }).parse(b);
                try { const forward = await forwardRequest(runtime(), { requestId: input.id, to: input.to, note: input.note }, actor); return j({ forward, message: 'Forwarded to ' + forward.to + '.' }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Email status unconfirmed. Check the mail provider before retrying.' }, status || 500); }
            }
            if (action === 'admin-reply-rule') {
                const input = z.object({ rule: z.string().max(500).optional(), removeId: z.string().uuid().optional(), issue: z.string().max(40).nullable().optional() }).parse(b);
                try { await saveReplyRule(runtime(), input, actor); return j({ ...(await replyDeskOptions(runtime())), links: await publicCoaLinks(), team: await teamMembers(runtime()), message: input.removeId ? 'Rule removed.' : 'Rule saved. The next drafts will follow it.' }); }
                catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'The rule could not be saved.' }, status || 500); }
            }
            if (action === 'admin-coa-process') {
                return j({ error: 'Automatic COA sending is disabled. Prepare a reply for Ash to review in Jarvis.' }, 409);
            }
            if (action === 'admin-config') {
                const cfg = z.object({ packDiscounts: z.record(z.number().min(0).max(100).nullable()), shippingCents: z.number().int().min(0).max(100000).nullable().optional(), freeShippingAt: z.number().int().min(0).max(1000000).optional(), presalesEnabled: z.boolean(), rewardsEnabled: z.boolean(), affiliateEnabled: z.boolean(),
                    shippingOptions: z.object({ standardEnabled: z.boolean(), expeditedEnabled: z.boolean(), overnightEnabled: z.boolean(), freeStandardEnabled: z.boolean(), standardHandlingCents: z.number().int().min(0).max(100000), expeditedHandlingCents: z.number().int().min(0).max(100000), overnightHandlingCents: z.number().int().min(0).max(100000), carriers: z.array(z.enum(['USPS', 'UPS', 'FedEx'])).min(1).transform(values => [...new Set(values)]) }).strict().optional(),
                }).parse(b);
                if (Object.keys(cfg.packDiscounts).some(k => !['1', '3', '5', '10'].includes(k)))
                    throw new Error('Unknown pack size.');
                // Older admin pages do not know about delivery options or newer settings.
                // Preserve the current merged runtime values unless explicitly submitted.
                const currentConfig = await config();
                const nextConfig = { ...currentConfig, ...cfg, shippingCents: cfg.shippingCents === undefined ? currentConfig.shippingCents : cfg.shippingCents, freeShippingAt: cfg.freeShippingAt ?? currentConfig.freeShippingAt, packDiscounts: { ...currentConfig.packDiscounts, ...cfg.packDiscounts, '1': 0 }, shippingOptions: cfg.shippingOptions ? { ...cfg.shippingOptions, ...(currentConfig.shippingOptions.services ? { services: currentConfig.shippingOptions.services } : {}) } : currentConfig.shippingOptions };
                await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'store', JSON.stringify(nextConfig));
                return j({ message: 'Store settings saved.' });
            }
            if (action === 'admin-product') {
                const packPricingMode = z.enum(['automatic', 'custom']).optional().parse(b.packPricingMode);
                const data = z.object({ batch: z.object({ lot: z.string().trim().max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/).nullable(), reportRef: z.string().max(200).regex(/^(?:public:[A-Za-z0-9._-]+|private:[a-f0-9]{64})$/).nullable(), coaAvailable: z.boolean() }).optional(), publicationRelease: z.object({lot:z.string(),reason:z.string().optional()}).nullable().optional(), availability: z.enum(availabilityOptions).optional(), preorder: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), ships: z.string().trim().min(1).max(120) }).nullable().optional(), sale: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), starts: z.string().datetime(), ends: z.string().datetime() }).nullable().optional(), price: z.number().int().min(1).max(9999999), packPrices: z.record(z.number().int().min(1).max(99999999).nullable()).optional(), inStock: z.boolean(), purchasable: z.boolean(), stockQuantity: z.number().int().min(0).max(100000).nullable(), maxQuantity: z.number().int().min(1).max(100000) }).parse(b);
                if (data.sale && Date.parse(data.sale.ends) <= Date.parse(data.sale.starts)) throw new Error('Sale end must follow its start.');
                if (Object.keys(data.packPrices || {}).some(n => !['3','5','10'].includes(n))) throw new Error('Unknown pack size.');
                const currentProduct = (await catalog(false, true)).find(p => p.id === b.id);
                if (!currentProduct) throw new Error('Product not found.');
                const savedRow = await one<{data:string}>('SELECT data FROM product_overrides WHERE id=?', b.id);
                if (typeof b.expectedVersion !== 'string' || b.expectedVersion !== currentProduct.editVersion || b.expectedVersion !== await coaHash(savedRow?.data || '')) throw new Error('This product changed or the editor is outdated. Refresh administration and review the latest values before saving.');
                const previousBatch = (await adminBatchRecords(database(), [currentProduct]))[0];
                if (data.batch) {
                    if (!b.expectedBatch || b.expectedBatch.lot !== previousBatch?.lot || b.expectedBatch.reportRef !== previousBatch?.reportRef || b.expectedBatch.coaAvailable !== previousBatch?.coaAvailable) throw new Error('The current lot or original report changed. Refresh administration before saving.');
                    const unchanged = previousBatch && data.batch.lot === previousBatch.lot && data.batch.reportRef === previousBatch.reportRef && data.batch.coaAvailable === previousBatch.coaAvailable;
                    if (!unchanged) data.batch = await validateBatchEdit(database(), currentProduct, data.batch);
                    // A price-only save must not convert a legacy mismatched report into a new association.
                    if (unchanged && currentProduct.batch === undefined) delete data.batch;
                } else if (currentProduct.batch !== undefined) data.batch = currentProduct.batch;
                const lotChanged = data.batch !== undefined && data.batch.lot !== (previousBatch?.lot || null);
                // Release attestations are accepted only through this owner-only path, never from a raw client object.
                data.publicationRelease = lotChanged ? null : currentProduct.publicationRelease;
                if (b.releaseReviewed === true) {
                    if (actor.role !== 'owner') throw new Error('Only an owner can release a product review hold.');
                    const lot = data.batch?.lot || previousBatch?.lot || null;
                    if (!sourcePublicationHold(currentProduct) || !lot || blockedReleaseLot(currentProduct, lot)) throw new Error('Identify the verified current selling lot. The older flagged Wolverine lot cannot be released here.');
                    if (!data.stockQuantity || data.stockQuantity <= 0) throw new Error('Enter the verified stock quantity before releasing this lot.');
                    data.publicationRelease = { lot, reason: z.string().trim().min(10).max(500).parse(b.releaseReason) };
                }
                const nextProduct = { ...currentProduct, ...data };
                if (data.availability !== undefined) {
                    if (data.availability === 'available' && hasPublicationHold(nextProduct)) throw new Error('Review the current lot and complete the owner release confirmation before making this product available.');
                    data.inStock = data.availability === 'available';
                    data.purchasable = data.availability === 'available';
                } else if (currentProduct.availability !== undefined) data.availability = currentProduct.availability;
                if (hasPublicationHold(nextProduct)) { data.inStock = false; data.purchasable = false; }
                // Optional fields omitted by an older editor retain their current source.
                if (!Object.hasOwn(b, 'sale') && currentProduct.sale !== undefined) data.sale = currentProduct.sale;
                // Reprice on the server as well: an older editor must not save old pack totals with a new base price.
                const basePriceChanged = data.price !== currentProduct.price;
                if (supportsPacks(currentProduct) && (packPricingMode === 'automatic' || (basePriceChanged && packPricingMode !== 'custom'))) {
                    data.packPrices = standardPackPrices(data.price);
                } else {
                    if (supportsPacks(currentProduct) && basePriceChanged && packPricingMode === 'custom' && !Object.hasOwn(b, 'packPrices')) throw new Error('Enter the custom pack totals or use automatic pack pricing.');
                    if (!Object.hasOwn(b, 'packPrices') && currentProduct.packPrices !== undefined) data.packPrices = currentProduct.packPrices;
                }
                if (currentProduct.preorder !== undefined && !Object.hasOwn(b, 'preorder')) throw new Error('Preorder settings require the current product editor. Refresh administration before editing this product.');
                const db = withAuditDb(database(), { ...auditActor, summary: `${currentProduct.name} product settings updated` });
                const guard = uid(), versionGuard = uid(), batchGuard = uid();
                try { await db.batch([
                    db.prepare(inventorySql.checkProductVersion).bind(versionGuard, savedRow?.data ?? null, b.id),
                    ...(lotChanged ? [db.prepare(inventorySql.checkBatchEdit).bind(batchGuard, b.id, b.id)] : []),
                    db.prepare(inventorySql.checkInventoryEdit).bind(guard, data.stockQuantity, b.id, b.expectedStock ?? null, b.id),
                    db.prepare(inventorySql.updateProduct).bind(b.id, JSON.stringify(data)),
                    ...[guard,versionGuard,...(lotChanged?[batchGuard]:[])].map(id=>db.prepare(inventorySql.clearGuard).bind(id)),
                ]); } catch { throw new Error(lotChanged ? 'The lot cannot change while stock is reserved or paid orders await fulfillment. Complete those orders first, then refresh. No changes were saved.' : 'The product or reserved stock changed. Refresh administration and review the latest values. No changes were saved.'); }
                return j({ message: 'Product updated.' });
            }
            if (action === 'admin-campaign') {
                const data = z.object({ title: z.string().min(2).max(100), starts: z.string().datetime(), ends: z.string().datetime(), ships: z.string().min(2).max(100), productIds: z.array(z.number().int()).min(1), maxPerCustomer: z.number().int().min(1).max(100) }).parse(b);
                if (!currentSelection(data.productIds)) throw new Error('Choose products from the current catalog.');
                if (Date.parse(data.ends) <= Date.parse(data.starts))
                    throw new Error('Closing date must follow opening date.');
                const id = typeof b.id === 'string' ? b.id : uid();
                await run('INSERT INTO campaigns(id,data,active) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=excluded.active', id, JSON.stringify(data), b.active ? 1 : 0);
                return j({ message: 'Presale saved.' });
            }
            if (action === 'admin-request') {
                const id = z.string().uuid().parse(b.id);
                const status = z.enum(['new', 'in_progress', 'resolved', 'spam', 'reviewed', 'deleted']).parse(b.status);
                if (b.expectedStatus === undefined)
                    return j({ error: 'Refresh the request list before changing its status.', code: 'request_refresh_required' }, 400);
                // Compare the saved value exactly, including legacy statuses. This
                // only records an inbox workflow decision; it never approves an
                // affiliate, changes request content or processes an email.
                const expectedStatus = z.string().min(1).max(50).parse(b.expectedStatus);
                const result = await run('UPDATE requests SET status=? WHERE id=? AND status=? AND kind IN (\'contact\',\'stock\',\'affiliate\')', status, id, expectedStatus);
                if (!result.meta.changes) {
                    const existing = await one('SELECT id FROM requests WHERE id=? AND kind IN (\'contact\',\'stock\',\'affiliate\')', id);
                    return existing
                        ? j({ error: 'This request changed since you loaded it. Refresh the request list and try again.', code: 'request_status_conflict' }, 409)
                        : j({ error: 'Request not found.' }, 404);
                }
                return j({ ok: true, id, status, message: 'Request status updated.' });
            }
            if (action === 'admin-reconcile') {
                const o = await one<{
                    owner: string;
                }>('SELECT owner FROM orders WHERE id=?', str(b.id, 50));
                if (!o)
                    throw new Error('Order not found.');
                return j(await reconcile(o.owner, b.id, [], auditActor));
            }
            if (action === 'admin-order') {
                const status = z.enum(['shipped', 'delivered']).parse(b.status);
                const o = await one<{
                    data: string;
                    status: string;
                }>('SELECT data,status FROM orders WHERE id=?', str(b.id, 50));
                if (!o || !['paid', 'shipped'].includes(o.status))
                    throw new Error('Only verified paid orders may be fulfilled.');
                if (parse<Record<string, any>>(o.data, {}).hold)
                    throw new Error('This order is on hold for a reported problem. Clear the hold before marking it shipped.');
                if (status === 'shipped' && o.status === 'paid') {
                    const blocked = coaBlockedItems(parse<Record<string, any>>(o.data, {}).items, await catalog(false, true));
                    if (blocked.length) throw new Error(coaBlockMessage(blocked));
                }
                const data = { ...parse(o.data, {}), tracking: str(b.tracking, 200) };
                await run('UPDATE orders SET status=?,data=?,updated=? WHERE id=?', status, JSON.stringify(data), timestamp(), b.id);
                return j({ message: 'Order updated.' });
            }
            if (action === 'admin-reward') {
                const owner = str(b.owner, 100);
                if (!await one('SELECT id FROM profiles WHERE id=?', owner))
                    throw new Error('Customer not found.');
                await run('INSERT INTO rewards(id,owner,points,reason,created) VALUES(?,?,?,?,?)', uid(), owner, z.number().int().min(-100000).max(100000).parse(b.points), str(b.reason, 200), timestamp());
                return j({ message: 'Reward entry saved.' });
            }
        }
        return j({ error: 'Not found.' }, 404);
    }
    catch (e) {
        const message = e instanceof z.ZodError ? 'Please check the required fields and their formats.' : (e as Error).message;
        return j({ error: message }, 400);
    }
}
