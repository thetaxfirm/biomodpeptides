import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unavailableOrder } from '@/lib/catalog-visibility';
import { one, run, timestamp, parse, runtime, database } from '@/lib/runtime';
import { readGuest } from '@/lib/guest-checkout';
import { paymentEnvironment, paymentProvider } from '@/lib/payments';
import { createAnetAdapter } from '@/lib/authorizenet-payments';
import { anetOrderDetails } from '@/lib/order-summary';
import type { StoreGetContext } from '@/lib/store-api/context';

export async function checkoutRead(context: StoreGetContext) {
    const { req, action, u } = context;
    if (action === 'pay') {
        // Authorize.net Accept Hosted: issue a fresh single-use token and POST the customer to the hosted card form.
        const page = (title: string, body: string, status = 200) => new NextResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + title + '</title><style>body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#f2ede4;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}a,button{color:#0b0b0b;background:#c8a46a;border:0;border-radius:6px;padding:12px 20px;font:inherit;text-decoration:none;cursor:pointer}</style></head><body><main>' + body + '</main></body></html>', { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
        const esc = (v: string) => v.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        const fail = (message: string, status = 400) => page('Payment unavailable', '<h1>Payment unavailable</h1><p>' + esc(message) + '</p><p><a href="/account/orders">View my orders</a></p>', status);
        // A member, or the guest whose browser session placed the order.
        const payer = u || await readGuest(database(), (await cookies()).get('bm_session')?.value);
        if (!payer)
            return fail('Please sign in to continue.', 401);
        if (paymentProvider(runtime()) !== 'authorizenet')
            return fail('This checkout is not available.', 404);
        const id = String(req.nextUrl.searchParams.get('id') || '');
        if (!/^[a-f0-9-]{36}$/.test(id))
            return fail('Order not found.', 404);
        const o = await one<{ id: string; status: string; total: number; checkout_ref: string; data: string; created: number }>('SELECT id,status,total,checkout_ref,data,created FROM orders WHERE id=? AND owner=?', id, payer.id);
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
            const form = await adapter.hostedForm(order, { email: payer.email, customerId: payer.id, ...saved.address }, anetOrderDetails(saved));
            return page('Secure payment', '<h1>Opening secure payment…</h1><form id="pay" method="post" action="' + esc(form.action) + '"><input type="hidden" name="token" value="' + esc(form.token) + '"><button type="submit">Continue to secure payment</button></form><script>document.getElementById("pay").submit()</script>');
        }
        catch (e) {
            // Log and show the provider's error code (never credentials) so setup problems can be diagnosed.
            const detail = e instanceof Error && e.name === 'AnetPaymentError' ? ' ' + e.message : '';
            console.error('Authorize.net hosted form failed:', e instanceof Error ? e.name + ': ' + e.message : 'unknown error');
            return fail('The payment page could not be opened. We could not confirm the payment status. Check your orders or contact Biomod before paying again.' + detail, 502);
        }
    }
}

