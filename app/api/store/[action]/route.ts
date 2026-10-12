import { changeHistory, auditRun, withAuditDb, recordChange, type AuditActor } from '@/lib/change-history';
import { recoveryAdminStatus } from '@/lib/checkout-recovery';
import { coaAutomationStatus, coaDeliveryStatuses, enqueueCoaRequest, enqueueRequestAlert, processCoaOutbox, saveCoaConfig } from '@/lib/coa-outbox';
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
import { availabilityOptions, hasPublicationHold } from '@/lib/availability';
import { all, one, run, uid, timestamp, parse, runtime, database } from '@/lib/runtime';
import { checkout, reconcile, addressSchema, issueQuote } from '@/lib/checkout';
import { getPaymentStatus, paymentEnvironment, paymentProvider } from '@/lib/payments';
import { createAnetAdapter } from '@/lib/authorizenet-payments';
import { anetOrderDetails } from '@/lib/order-summary';
import { packSizes, supportsPacks } from '@/lib/packs';
import { searchReport, seoConfig } from '@/lib/seo-policy';
import { salesDiagnostics } from '@/lib/sales-diagnostics';
import { can, permissionsFor, type StaffPermission } from '@/lib/staff';
import { saveStaffMember, staffDirectory } from '@/lib/staff-store';
export const dynamic = 'force-dynamic';
// What each admin write needs. An admin action missing here requires the owner.
const adminActionPermission: Record<string, StaffPermission> = {
    'admin-order': 'orders:fulfill', 'admin-reconcile': 'orders:reconcile',
    'admin-request': 'requests:write', 'admin-coa-process': 'requests:write',
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
                ...(kind === 'contact' ? [processCoaOutbox(deliveryEnv, { requestId, purpose: 'coa', limit: 1 })] : []),
                processCoaOutbox(deliveryEnv, { requestId, purpose: 'request-alert', limit: 1 }),
            ]);
        });
    } catch {
        // A missing response lifecycle cannot undo a saved inquiry. The durable
        // queue is still available to the scheduled retry or authorized admin.
    }
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
        if (action === 'admin') {
            // Every role sees orders; other sections are sent only to roles that hold them.
            const { role } = await requireStaff('orders:read');
            const allowed = (permission: StaffPermission) => can(role, permission);
            const requests = allowed('requests:write') ? await all<{ id: string; data: string }>("SELECT * FROM requests WHERE kind IN ('contact','stock','affiliate') ORDER BY created DESC LIMIT 200") : [];
            return j({ role, permissions: permissionsFor(role), checkoutRecovery: await recoveryAdminStatus(runtime()), searchPublishing: allowed('reports:read') ? searchReport(seoConfig(runtime())) : null, config: await config(), products: await catalog(false), orders: (await all<{
                    data: string;
                }>('SELECT id,owner,status,total,data,created FROM orders ORDER BY created DESC LIMIT 200')).map(o => ({ ...o, data: adminOrderView(parse(o.data, {})) })), requests: requests.map(o => ({ ...o, data: presentationData(parse(o.data, {})) })), coaAutomation: allowed('requests:write') ? await coaAutomationStatus(runtime(), requests.map(r => r.id)) : null, campaigns: allowed('store:write') ? (await all<{
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
        const { action } = await params;
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
            if (action === 'admin-coa-process') {
                const id = z.string().uuid().parse(b.id);
                await recordChange(database(), { ...auditActor, action: 'coa.process_requested', entityType: 'request', entityId: id, summary: 'Staff requested original-report email processing', status: 'attempted' });
                const env = auditEnv();
                await enqueueCoaRequest(env, id);
                await processCoaOutbox(env, { requestId: id, purpose: 'coa', limit: 1 });
                const status = (await coaDeliveryStatuses(runtime(), [id]))[id]?.coa;
                return j({ message: status?.status === 'accepted' ? 'The email provider accepted this COA email. Inbox delivery is not yet confirmed.' : status?.status === 'duplicate' ? 'This original report already has an email record. Check its existing status.' : status?.status === 'queued' || status?.status === 'sending' ? 'This COA is queued for email processing.' : 'This request requires review or COA automation is disabled.', status });
            }
            if (action === 'admin-config') {
                const cfg = z.object({ packDiscounts: z.record(z.number().min(0).max(100).nullable()), shippingCents: z.number().int().min(0).max(100000).nullable(), freeShippingAt: z.number().int().min(0).max(1000000), presalesEnabled: z.boolean(), rewardsEnabled: z.boolean(), affiliateEnabled: z.boolean(),
                    shippingOptions: z.object({ standardEnabled: z.boolean(), expeditedEnabled: z.boolean(), overnightEnabled: z.boolean(), freeStandardEnabled: z.boolean(), standardHandlingCents: z.number().int().min(0).max(100000), expeditedHandlingCents: z.number().int().min(0).max(100000), overnightHandlingCents: z.number().int().min(0).max(100000), carriers: z.array(z.enum(['USPS', 'UPS', 'FedEx'])).min(1).transform(values => [...new Set(values)]) }).strict().optional(),
                }).parse(b);
                if (Object.keys(cfg.packDiscounts).some(k => !['1', '3', '5', '10'].includes(k)))
                    throw new Error('Unknown pack size.');
                // Older admin pages do not know about delivery options or newer settings.
                // Preserve the current merged runtime values unless explicitly submitted.
                const currentConfig = await config();
                const nextConfig = { ...currentConfig, ...cfg, packDiscounts: { ...currentConfig.packDiscounts, ...cfg.packDiscounts, '1': 0 }, shippingOptions: cfg.shippingOptions ?? currentConfig.shippingOptions };
                await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'store', JSON.stringify(nextConfig));
                return j({ message: 'Store settings saved.' });
            }
            if (action === 'admin-product') {
                const data = z.object({ availability: z.enum(availabilityOptions).optional(), preorder: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), ships: z.string().trim().min(1).max(120) }).nullable().optional(), sale: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), starts: z.string().datetime(), ends: z.string().datetime() }).nullable().optional(), price: z.number().int().min(1).max(9999999), packPrices: z.record(z.number().int().min(1).max(99999999).nullable()).optional(), inStock: z.boolean(), purchasable: z.boolean(), stockQuantity: z.number().int().min(0).max(100000).nullable(), maxQuantity: z.number().int().min(1).max(100) }).parse(b);
                if (data.sale && Date.parse(data.sale.ends) <= Date.parse(data.sale.starts)) throw new Error('Sale end must follow its start.');
                if (Object.keys(data.packPrices || {}).some(n => !['3','5','10'].includes(n))) throw new Error('Unknown pack size.');
                const currentProduct = (await catalog(false)).find(p => p.id === b.id);
                if (!currentProduct) throw new Error('Product not found.');
                // A chosen status is deliberate; older editors must not erase it.
                if (data.availability !== undefined) {
                    if (data.availability === 'available' && hasPublicationHold(currentProduct)) throw new Error('This product has a publication hold. Confirm its release before making it available.');
                    data.inStock = data.availability === 'available';
                    data.purchasable = data.availability === 'available';
                } else if (currentProduct.availability !== undefined) data.availability = currentProduct.availability;
                if (hasPublicationHold(currentProduct)) { data.inStock = false; data.purchasable = false; }
                // Optional fields omitted by an older editor retain their current source.
                if (!Object.hasOwn(b, 'sale') && currentProduct.sale !== undefined) data.sale = currentProduct.sale;
                if (!Object.hasOwn(b, 'packPrices') && currentProduct.packPrices !== undefined) data.packPrices = currentProduct.packPrices;
                if (currentProduct.preorder !== undefined && !Object.hasOwn(b, 'preorder')) throw new Error('Preorder settings require the current product editor. Refresh administration before editing this product.');
                const db=withAuditDb(database(), {...auditActor, summary: `${currentProduct.name} pricing or availability updated`});const guard=uid();try{await db.batch([db.prepare(inventorySql.checkInventoryEdit).bind(guard,data.stockQuantity,b.id,b.expectedStock??null,b.id),db.prepare(inventorySql.updateProduct).bind(b.id,JSON.stringify(data)),db.prepare(inventorySql.clearGuard).bind(guard)]);}catch{throw new Error('Inventory cannot be reduced below stock reserved by existing orders.');}
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
                const status = z.enum(['new', 'in_progress', 'resolved', 'spam', 'reviewed']).parse(b.status);
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
