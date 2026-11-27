import { PROMO_COOKIE, promotion, type PromoRecord } from '@/lib/promotions';
import { storedPromotions } from '@/lib/promo-codes';
import { cookies } from 'next/headers';
import { createCartImports } from '@/lib/cart-import';
import { customer } from '@/lib/auth';
import { quote, validateLines } from '@/lib/commerce';
import { one, database } from '@/lib/runtime';
import { readGuest } from '@/lib/guest-checkout';

export const cartImports = () => createCartImports({ db: database(), normalize: validateLines, validate: quote });
export type Shopper = { id: string; email: string; name: string; guest: boolean };
async function shopperFor(sessionId: string | undefined): Promise<Shopper | null> {
    const u = await customer();
    if (u) return { ...u, guest: false };
    return readGuest(database(), sessionId);
}
export async function requireShopper(sessionId: string | undefined): Promise<Shopper> {
    const shopper = await shopperFor(sessionId);
    if (!shopper) throw new Error('Please sign in or continue as a guest.');
    return shopper;
}
export const shopperCart = async (shopper: Shopper, sessionCart: string) => shopper.guest ? sessionCart
    : (await one<{ cart: string }>('SELECT cart FROM customer_carts WHERE id=?', shopper.id))?.cart;
export async function currentPromoCode() {
    const jar = await cookies();
    const saved = jar.get(PROMO_COOKIE)?.value;
    if (!saved) return '';
    // Owner-added codes have to survive a page load, so the stored list is read here too. Failing to
    // read it is not the customer's fault and must not cost them their code: the cookie is only
    // thrown away when the store can see the full list and still refuses what is in it.
    let stored: PromoRecord[] | null = null;
    try { stored = await storedPromotions(database(), { throwOnReadError: true }); } catch { stored = null; }
    if (stored === null) return '';
    try { return promotion(saved, stored)?.code || ''; }
    catch {
        if (stored !== null) jar.delete(PROMO_COOKIE);
        return '';
    }
}
