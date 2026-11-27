import { autoDraftNewRequest } from '@/lib/request-replies';
import { normalizeLot, hasInvalidLabelLot } from '@/lib/coa-delivery';
import { withAuditDb } from '@/lib/change-history';
import { enqueueCoaRequest, enqueueRequestAlert, processCoaOutbox } from '@/lib/coa-outbox';
import { PROMO_COOKIE } from '@/lib/promotions';
import { textOfferSignup } from '@/lib/text-offer';
import { emailOfferSignup } from '@/lib/email-offer';
import { rememberPopupEmail } from '@/lib/checkout-contact';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { customer, requireCustomer, rateLimit } from '@/lib/auth';
import { catalog } from '@/lib/commerce';
import { one, run, uid, timestamp, runtime, database } from '@/lib/runtime';
import type { StorePostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';
import { currentPromoCode } from '@/lib/store-api/shopper';
import { captureContact } from '@/lib/store-api/contact-capture';

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
export async function inquiryWrite(context: StorePostContext) {
    const { req, action, b, secure, s } = context;
    if (action === 'contact') {
        // labelLot: the lot the customer reads off their own vial; it decides any COA (owner rule, Oct 14 2026).
        const labelLot = normalizeLot(b.labelLot);
        if (hasInvalidLabelLot(b)) throw new Error('Enter a valid lot number using letters, numbers, spaces or dashes.');
        const data = { name: str(b.name, 100), email: z.string().email().parse(b.email), subject: str(b.subject, 150), message: str(b.message, 5000), ...(labelLot ? { labelLot } : {}) };
        if (b.website)
            return j({ ok: true });
        const u = await customer();
        const id = uid();
        await run('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', id, u?.id || null, 'contact', JSON.stringify(data), timestamp());
        await captureContact({ email: data.email, owner: u?.id || null, name: data.name, source: 'contact_form' });
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
    if (action === 'affiliate') return j({ error: 'Please reload the affiliate program to review the current agreement before applying.' }, 409);
    if (action === 'email-offer') {
        await rateLimit('email-offer:' + (req.headers.get('cf-connecting-ip') || s.id), 5);
        const result = await emailOfferSignup(database(), { email: b.email, consent: b.consent, path: b.path, trap: b.company }, timestamp(), crypto.randomUUID());
        // Checkout starts with this email filled in. Losing that convenience must not fail the sign-up.
        if (result.saved) await rememberPopupEmail(database(), s.id, result.email, timestamp(), uid()).catch(() => undefined);
        return j({ saved: true });
    }
    if (action === 'text-offer') {
        await rateLimit('text-offer-strict:' + (req.headers.get('cf-connecting-ip') || s.id), 5);
        const result = await textOfferSignup(database(), runtime() as unknown as Record<string, string | undefined>, { phone: b.phone, consent: b.consent }, req.nextUrl.origin, timestamp(), uid());
        if (result.status !== 'shown') return j(result);
        // No text provider yet: the code is shown, and applied unless the cart already carries another code.
        const applied = !await currentPromoCode();
        if (applied) (await cookies()).set(PROMO_COOKIE, result.code, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 2592000 });
        return j({ ...result, applied, message: result.message + (applied ? ' It is applied to your order.' : ' Enter it under "Have a promo code?".') });
    }
}

