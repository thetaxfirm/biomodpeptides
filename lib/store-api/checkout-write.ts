import { z } from 'zod';
import { customer, rateLimit } from '@/lib/auth';
import { unavailableOrder } from '@/lib/catalog-visibility';
import { catalog, validateLines } from '@/lib/commerce';
import { mixesPreorder, preorderSeparateMessage } from '@/lib/preorders';
import { one, uid, timestamp, parse, runtime, database } from '@/lib/runtime';
import { checkout, reconcile, issueQuote, AddressCheckError } from '@/lib/checkout';
import { readGuestRecord, saveGuest, guestOrderRecord } from '@/lib/guest-checkout';
import { saveCheckoutContact, subscribeFromCheckout } from '@/lib/checkout-contact';
import { paymentEnvironment } from '@/lib/payments';
import type { StorePostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';
import { cartImports, requireShopper, shopperCart, currentPromoCode } from '@/lib/store-api/shopper';
import { captureContact } from '@/lib/store-api/contact-capture';

export async function checkoutWrite(context: StorePostContext) {
    const { req, action, b, s } = context;
    if (action === 'delivery') {
        const u = await requireShopper(s.id);
        // A choice refers only to a rate in this customer's stored quote.
        // Both identifiers are required together; client prices are never accepted.
        const selection = b.quoteId !== undefined || b.shippingOptionId !== undefined
            ? z.object({ quoteId: z.string().uuid(), shippingOptionId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).parse({ quoteId: b.quoteId, shippingOptionId: b.shippingOptionId })
            : undefined;
        if (!u.guest) await cartImports().assertResolved(u.id, s.id);
        try {
            return j(await issueQuote(u.id, validateLines(parse(await shopperCart(u, s.cart), [])), b.address, await currentPromoCode(), selection, b.addressConfirmed === true));
        } catch (e) {
            // USPS flagged the address. The checkout page shows the reason beside the form and lets the customer confirm.
            if (e instanceof AddressCheckError) return j({ error: e.message, addressProblem: e.addressProblem }, 422);
            throw e;
        }
    }
    // First checkout screen (owner, Nov 27 2026): a guest's email and mobile number are saved before the address.
    if (action === 'checkout-contact') {
        if (await customer()) return j({ message: 'You are signed in.' });
        await rateLimit('checkout-contact:' + (req.headers.get('cf-connecting-ip') || s.id), 10);
        if (!validateLines(parse(s.cart, [])).length) throw new Error('Your cart is empty.');
        const contact = await saveCheckoutContact(database(), s.id, { email: b.email, phone: b.phone, emailOptIn: b.emailOptIn, textConsent: b.textConsent }, timestamp(), uid());
        // The list and the shared contact book are secondary: a failure there must not stop checkout.
        if (contact.emailOptIn) await subscribeFromCheckout(database(), contact.email, timestamp(), crypto.randomUUID()).catch(() => false);
        await captureContact({ email: contact.email, owner: null, phone: contact.phone, source: 'order' });
        return j({ contact });
    }
    if (action === 'guest-start') {
        if (await customer()) return j({ message: 'You are signed in.' });
        const guest = await saveGuest(database(), s.id, { email: b.email, businessType: b.businessType, attested: b.attested, smsConsent: b.smsConsent }, timestamp(), uid());
        await captureContact({ email: guest.email, owner: null, source: 'order' });
        return j({ guest });
    }
    if (action === 'checkout') {
        const u = await requireShopper(s.id);
        if (!u.guest) await cartImports().assertResolved(u.id, s.id);
        const checkoutLines = validateLines(parse(await shopperCart(u, s.cart), []));
        // Preorders are purchased in their own order, never mixed with in-stock items.
        if (mixesPreorder(checkoutLines, await catalog())) return j({ error: preorderSeparateMessage }, 409);
        // Presale limits are counted per member, so a presale needs an account.
        if (u.guest && checkoutLines.some(line => line.presaleId)) return j({ error: 'Presale items need a member account. Sign in or become a member to order them.' }, 409);
        const guestRecord = u.guest ? await readGuestRecord(database(), s.id) : null;
        const placed = await checkout(u.id, checkoutLines, b, await currentPromoCode(), u.guest ? { email: u.email, extra: guestOrderRecord(guestRecord) } : undefined);
        // The delivery phone joins the guest's contact record (members give theirs at sign-up).
        if (u.guest) await captureContact({ email: u.email, owner: null, name: typeof b.address?.name === 'string' ? b.address.name : undefined, phone: typeof b.address?.phone === 'string' ? b.address.phone : undefined, source: 'order' });
        return j(placed);
    }
    if (action === 'resume') {
        const u = await requireShopper(s.id);
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
        const u = await requireShopper(s.id);
        return j(await reconcile(u.id, str(b.id, 50)));
    }
}

