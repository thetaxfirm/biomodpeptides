import { PROMO_COOKIE, promotion } from '@/lib/promotions';
import { storedPromotions } from '@/lib/promo-codes';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { customer, requireCustomer } from '@/lib/auth';
import { currentCart } from '@/lib/catalog-visibility';
import { catalog, quote, validateLines } from '@/lib/commerce';
import { one, run, uid, timestamp, parse, database } from '@/lib/runtime';

import { packSizes, supportsPacks } from '@/lib/packs';
import type { StorePostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';
import { cartImports, currentPromoCode } from '@/lib/store-api/shopper';

export async function cartWrite(context: StorePostContext) {
    const { action, b, secure, s } = context;
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
        const selected = promotion(b.code, await storedPromotions(database()));
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
}

