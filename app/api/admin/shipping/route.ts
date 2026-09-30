import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buyLabel, easypostReady, sendTrackingEmail } from '@/lib/easypost';
import { one, run, parse, runtime, timestamp } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
// Admin only: buy the cheapest USPS/UPS label for a paid order, save tracking, mark it shipped and email the customer.
export async function POST(req: NextRequest) {
    try {
        if (req.headers.get('origin') !== req.nextUrl.origin)
            return j({ error: 'Please refresh the page and try again.' }, 403);
        await requireAdmin();
        const env = runtime();
        if (!easypostReady(env))
            return j({ error: 'EasyPost is not connected. Add EASYPOST_API_KEY in Cloudflare.' }, 400);
        const body = await req.json().catch(() => ({})) as { id?: unknown; resend?: unknown };
        const id = typeof body.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) ? body.id : '';
        if (!id)
            return j({ error: 'Order not found.' }, 404);
        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', id);
        if (!order)
            return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        if (body.resend === true) {
            if (!data.shipment?.tracking)
                return j({ error: 'This order has no label yet.' }, 400);
            const sent = await sendTrackingEmail(env, data.email || '', order.id, data.shipment, data.address?.name);
            return j({ message: sent ? 'Tracking email sent.' : 'Tracking email could not be sent. Check RESEND_API_KEY and the customer email.' });
        }
        // Claim the order first so a double click cannot buy two labels.
        const claim = await run("UPDATE orders SET status='labeling',updated=? WHERE id=? AND status='paid' AND json_extract(data,'$.shipment') IS NULL", timestamp(), id);
        if (!claim.meta.changes)
            return j({ error: data.shipment ? 'A label was already bought for this order.' : 'Only paid orders without a label can be shipped.' }, 409);
        let label;
        try {
            label = await buyLabel(env, data.address, data.items || [], 'BIOMOD ' + id.slice(0, 8));
        }
        catch (e) {
            await run("UPDATE orders SET status='paid',updated=? WHERE id=? AND status='labeling'", timestamp(), id);
            return j({ error: e instanceof Error ? e.message : 'The label could not be bought.' }, 502);
        }
        const next = { ...data, tracking: label.carrier + ' ' + label.tracking, shipment: label, shippedAt: timestamp() };
        await run("UPDATE orders SET status='shipped',data=?,updated=? WHERE id=?", JSON.stringify(next), timestamp(), id);
        const emailed = await sendTrackingEmail(env, data.email || '', order.id, label, data.address?.name);
        return j({ message: 'Label bought: ' + label.service + ', ' + label.tracking + (emailed ? '. Tracking emailed to the customer.' : '. Tracking email not sent.'), labelUrl: label.labelUrl });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
