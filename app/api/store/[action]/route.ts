import inventorySql from '@/lib/inventory-statements.json';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { session, customer, requireCustomer, requireAdmin, authReady, authCall, storeAuth, rateLimit } from '@/lib/auth';
import { presentationData } from '@/lib/private-presentation';
import { currentCart, currentProductId, currentSelection, orderView, unavailableOrder } from '@/lib/catalog-visibility';
import { catalog, config, quote, validateLines } from '@/lib/commerce';
import { all, one, run, uid, timestamp, parse, runtime, database } from '@/lib/runtime';
import { checkout, reconcile, addressSchema, issueQuote } from '@/lib/checkout';
import { getChasePaymentStatus } from '@/lib/chase-payments';
import { packSizes, supportsPacks } from '@/lib/packs';
import { searchReport, seoConfig } from '@/lib/seo-policy';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const str = (v: unknown, max = 2000) => z.string().trim().min(1).max(max).parse(v);
const safeReturn = (v: unknown) => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : '/account';
export async function GET(req: NextRequest, { params }: {
    params: Promise<{
        action: string;
    }>;
}) {
    try {
        const { action } = await params;
        const u = await customer();
        if (action === 'state') {
            const s = await session(req.nextUrl.protocol === 'https:');
            const ps = await catalog();
            const cfg = await config();
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
                totals = await quote(validateLines(cart));
            }
            catch (e) {
                cartError = (e as Error).message;
            }
            const payment = getChasePaymentStatus(runtime());
            const packOwner = u ? 'customer:' + u.id : 'guest:' + s.id;
            if(u) await run('UPDATE saved_packs SET owner=? WHERE owner=?',packOwner,'guest:'+s.id);
            const savedPacks = (await all<{id:string;name:string;products:string;updated:number}>('SELECT id,name,products,updated FROM saved_packs WHERE owner=? ORDER BY updated DESC',packOwner)).map(p=>({...p,products:parse(p.products,[])})).filter(p=>currentSelection(p.products)).map(p=>presentationData(p));
            return j({ products: ps, config: cfg, cart, wishlist, savedPacks, customer: u, authReady: authReady(), googleReady: authReady() && runtime().GOOGLE_SIGNIN_ENABLED === 'true', payment: { state: payment.state, enabled: payment.checkoutEnabled }, totals, cartError, cartNotice, campaigns: (await all<{
                    id: string;
                    data: string;
                    active: number;
                }>('SELECT id,data,active FROM campaigns WHERE active=1')).map<Record<string, any>>(c => ({ ...parse<Record<string, any>>(c.data, {}), id: c.id })).filter(c=>currentSelection(c.productIds)).map(c=>presentationData(c)), admin: Boolean(u && (runtime().STORE_ADMIN_EMAILS || '').toLowerCase().split(',').map(v => v.trim()).includes(u.email.toLowerCase())) });
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
                }>('SELECT id,kind,data,status,created FROM requests WHERE owner=? AND kind!=\'quote\' ORDER BY created DESC LIMIT 100', user.id)).map(r => ({ ...r, data: presentationData(parse(r.data, {})) })), rewards: presentationData(await all('SELECT points,reason,created FROM rewards WHERE owner=? ORDER BY created DESC LIMIT 100', user.id)) });
        }
        if (action === 'admin') {
            await requireAdmin();
            return j({ searchPublishing: searchReport(seoConfig(runtime())), config: await config(), products: await catalog(), orders: (await all<{
                    data: string;
                }>('SELECT id,owner,status,total,data,created FROM orders ORDER BY created DESC LIMIT 200')).map(o => ({ ...o, data: orderView(parse(o.data, {})) })), requests: (await all<{
                    data: string;
                }>('SELECT * FROM requests WHERE kind!=\'quote\' ORDER BY created DESC LIMIT 200')).map(o => ({ ...o, data: presentationData(parse(o.data, {})) })), campaigns: (await all<{
                    data: string;
                }>('SELECT * FROM campaigns')).map<Record<string, any>>(o => { const {data, ...row}=o; return { ...row, ...parse<Record<string, any>>(data, {}) }; }).filter(c=>currentSelection(c.productIds)).map(c=>presentationData(c)) });
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
        if (action === 'cart') {
            const lines = validateLines(b.cart);
            const totals = await quote(lines);
            await run('UPDATE sessions SET cart=?,updated=? WHERE id=?', JSON.stringify(lines), timestamp(), s.id);
            const u = await customer();
            if (u)
                await run('INSERT INTO customer_carts(id,cart,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET cart=excluded.cart,updated=excluded.updated', u.id, JSON.stringify(lines), timestamp());
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
            const d = await authCall('token?grant_type=password', { email: z.string().email().parse(b.email), password: z.string().min(1).max(200).parse(b.password) });
            await storeAuth(d, secure);
            return j({ returnTo: safeReturn(b.returnTo) });
        }
        if (action === 'auth-register') {
            const name = str(b.name, 100);
            const email = z.string().email().parse(b.email);
            const password = z.string().min(8).max(200).parse(b.password);
            const dob = new Date(str(b.dob, 10));
            const latest = new Date();
            latest.setFullYear(latest.getFullYear() - 21);
            if (!Number.isFinite(dob.getTime()) || dob > latest || b.accepted !== true)
                throw new Error('You must be 21 or older and agree to research-only purchasing.');
            if (password !== b.confirmPassword)
                throw new Error('Passwords do not match.');
            const d = await authCall('signup?redirect_to=' + encodeURIComponent(req.nextUrl.origin + '/login'), { email, password, data: { name, company: str(b.company, 150), phone: str(b.phone, 30), research_accepted: true } });
            return j({ message: 'Check your email to verify your account before signing in.', verificationRequired: true });
        }
        if (action === 'auth-recover') {
            await authCall('recover?redirect_to=' + encodeURIComponent(req.nextUrl.origin + '/reset-password'), { email: z.string().email().parse(b.email) });
            return j({ message: 'If this email has an account, a password reset link has been requested.' });
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
            c.delete('bm_access');
            c.delete('bm_refresh');
            return j({ ok: true });
        }
        if (action === 'contact') {
            const data = { name: str(b.name, 100), email: z.string().email().parse(b.email), subject: str(b.subject, 150), message: str(b.message, 5000) };
            if (b.website)
                return j({ ok: true });
            const u = await customer();
            const id = uid();
            await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, u?.id || null, 'contact', JSON.stringify(data), timestamp());
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
            await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', uid(), u.id, 'affiliate', JSON.stringify({ email: u.email, website: str(b.website, 500), message: str(b.message, 3000) }), timestamp());
            return j({ message: 'Your partner application has been saved.' });
        }
        if (action === 'delivery') {
            const u = await requireCustomer();
            return j(await issueQuote(u.id, validateLines(parse((await one<{
                cart: string;
            }>('SELECT cart FROM customer_carts WHERE id=?', (await requireCustomer()).id))?.cart, [])), b.address));
        }
        if (action === 'checkout') {
            const u = await requireCustomer();
            return j(await checkout(u.id, validateLines(parse((await one<{
                cart: string;
            }>('SELECT cart FROM customer_carts WHERE id=?', u.id))?.cart, [])), b));
        }
        if (action === 'resume') {
            const u = await requireCustomer();
            const o = await one<{
                checkout_url: string;
                status: string;
                data: string;
            }>('SELECT checkout_url,status,data FROM orders WHERE id=? AND owner=?', str(b.id, 50), u.id);
            if (!o || unavailableOrder(parse(o.data, {})) || !o.checkout_url || !['awaiting_payment', 'pending'].includes(o.status) || parse<Record<string, any>>(o.data, {}).environment !== runtime().CHASE_ENVIRONMENT)
                throw new Error('This payment requires review.');
            return j({ url: o.checkout_url });
        }
        if (action === 'reconcile') {
            const u = await requireCustomer();
            return j(await reconcile(u.id, str(b.id, 50)));
        }
        if (action.startsWith('admin-')) {
            await requireAdmin();
            if (action === 'admin-config') {
                const cfg = z.object({ packDiscounts: z.record(z.number().min(0).max(100).nullable()), shippingCents: z.number().int().min(0).max(100000).nullable(), freeShippingAt: z.number().int().min(0).max(1000000), presalesEnabled: z.boolean(), rewardsEnabled: z.boolean(), affiliateEnabled: z.boolean() }).parse(b);
                if (Object.keys(cfg.packDiscounts).some(k => !['1', '3', '5', '10'].includes(k)))
                    throw new Error('Unknown pack size.');
                await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'store', JSON.stringify(cfg));
                return j({ message: 'Store settings saved.' });
            }
            if (action === 'admin-product') {
                const data = z.object({ price: z.number().int().min(1).max(9999999), packPrices: z.record(z.number().int().min(1).max(99999999).nullable()).optional(), inStock: z.boolean(), purchasable: z.boolean(), stockQuantity: z.number().int().min(0).max(100000).nullable(), maxQuantity: z.number().int().min(1).max(100) }).parse(b);
                if (Object.keys(data.packPrices || {}).some(n => !['3','5','10'].includes(n))) throw new Error('Unknown pack size.');
                if (!(await catalog()).some(p => p.id === b.id))
                    throw new Error('Product not found.');
                const db=database();const guard=uid();try{await db.batch([db.prepare(inventorySql.checkInventoryEdit).bind(guard,data.stockQuantity,b.id,b.expectedStock??null,b.id),db.prepare(inventorySql.updateProduct).bind(b.id,JSON.stringify(data)),db.prepare(inventorySql.clearGuard).bind(guard)]);}catch{throw new Error('Inventory cannot be reduced below stock reserved by existing orders.');}
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
                await run('UPDATE requests SET status=? WHERE id=?', z.enum(['new', 'reviewed', 'resolved']).parse(b.status), str(b.id, 50));
                return j({ ok: true });
            }
            if (action === 'admin-reconcile') {
                const o = await one<{
                    owner: string;
                }>('SELECT owner FROM orders WHERE id=?', str(b.id, 50));
                if (!o)
                    throw new Error('Order not found.');
                return j(await reconcile(o.owner, b.id));
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
