import { ANONYMOUS_SESSION_COOKIE, needsAnonymousSession } from '@/lib/auth-return';
import { cookies } from 'next/headers';
import { session, staffRole, authReady } from '@/lib/auth';
import { presentationData } from '@/lib/private-presentation';
import { currentCart, currentProductId, currentSelection } from '@/lib/catalog-visibility';
import { catalog, config, quote, validateLines } from '@/lib/commerce';
import { all, one, run, timestamp, parse, runtime, database } from '@/lib/runtime';
import { readGuest, type GuestShopper } from '@/lib/guest-checkout';
import { readCheckoutContact } from '@/lib/checkout-contact';
import { getPaymentStatus } from '@/lib/payments';
import { permissionsFor } from '@/lib/staff';
import type { StoreGetContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';
import { cartImports, currentPromoCode } from '@/lib/store-api/shopper';

export async function stateRead(context: StoreGetContext) {
    const { req, action, u } = context;
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
        return j({ products: ps, config: cfg, cart, cartConflict, wishlist, savedPacks, customer: u, guest: u ? null : await readGuest(database(), s.id) as GuestShopper | null, contact: u ? null : await readCheckoutContact(database(), s.id).catch(() => null), authReady: authReady(), googleReady: authReady() && runtime().GOOGLE_SIGNIN_ENABLED === 'true', payment: { state: payment.state, enabled: payment.checkoutEnabled }, totals, cartError, cartNotice, campaigns: (await all<{
                id: string;
                data: string;
                active: number;
            }>('SELECT id,data,active FROM campaigns WHERE active=1')).map<Record<string, any>>(c => ({ ...parse<Record<string, any>>(c.data, {}), id: c.id })).filter(c=>currentSelection(c.productIds)).map(c=>presentationData(c)), admin: Boolean(role), staffRole: role, permissions: permissionsFor(role) });
    }
}

