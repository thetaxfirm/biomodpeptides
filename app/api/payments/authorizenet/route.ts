import { NextRequest, NextResponse } from 'next/server';
import { classifyAnetTransaction, createAnetAdapter, verifyAnetWebhookSignature } from '@/lib/authorizenet-payments';
import { reconcile } from '@/lib/checkout';
import { paymentProvider } from '@/lib/payments';
import { one, runtime } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
// Authorize.net webhook receiver. Register this URL in Merchant Interface → Account → Webhooks.
// The payload is only a signed hint: payment status is always re-read from the Authorize.net API.
const reply = (status: number) => new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req: NextRequest) {
    const env = runtime();
    if (paymentProvider(env) !== 'authorizenet')
        return reply(404);
    const raw = await req.text();
    if (raw.length > 20000)
        return reply(413);
    if (!verifyAnetWebhookSignature(raw, req.headers.get('x-anet-signature'), (env.AUTHORIZENET_SIGNATURE_KEY || '').trim()))
        return reply(401);
    let event: { eventType?: unknown; payload?: { entityName?: unknown; id?: unknown } };
    try {
        event = JSON.parse(raw);
    }
    catch {
        return reply(400);
    }
    const transId = typeof event.payload?.id === 'string' ? event.payload.id : typeof event.payload?.id === 'number' ? String(event.payload.id) : '';
    if (event.payload?.entityName !== 'transaction' || !/^\d{1,20}$/.test(transId) || typeof event.eventType !== 'string' || !event.eventType.startsWith('net.authorize.payment.'))
        return reply(200);
    try {
        const details = await createAnetAdapter(env).transactionDetails(transId);
        const invoice = (details?.order as Record<string, unknown> | undefined)?.invoiceNumber;
        if (typeof invoice !== 'string' || !/^[A-F0-9]{20}$/.test(invoice))
            return reply(200);
        const order = await one<{ id: string; owner: string; status: string; total: number }>('SELECT id,owner,status,total FROM orders WHERE checkout_ref=?', invoice);
        if (!order)
            return reply(200);
        if (['paid', 'shipped', 'delivered'].includes(order.status)) {
            // Refunds and voids after payment are handled by an administrator; nothing is changed automatically.
            return reply(200);
        }
        // A declined card leaves the order open so the customer can try another card on the hosted form.
        if (classifyAnetTransaction({ id: order.id, totalCents: order.total, currency: 'USD' }, details).state === 'failed')
            return reply(200);
        await reconcile(order.owner, order.id, [transId]);
        return reply(200);
    }
    catch {
        // Non-200 makes Authorize.net retry the notification later.
        return reply(500);
    }
}
