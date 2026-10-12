import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buyLabel, easypostReady, sendTrackingEmail, shippingConnection, readShipmentTracking } from '@/lib/easypost';
import { one, run, parse, runtime, timestamp } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
// Label creation does not confirm dispatch. All provider calls require administrator access.
export async function GET() {
    try { await requireAdmin(); return j(await shippingConnection(runtime())); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
}
export async function POST(req: NextRequest) {
    try {
        if (req.headers.get('origin') !== req.nextUrl.origin)
            return j({ error: 'Please refresh the page and try again.' }, 403);
        await requireAdmin();
        const env = runtime();
        if (!easypostReady(env))
            return j({ error: 'EasyPost is not connected. Add EASYPOST_API_KEY in Cloudflare.' }, 400);
        const body = await req.json().catch(() => ({})) as { id?: unknown; resend?: unknown; refreshTracking?: unknown };
        const id = typeof body.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) ? body.id : '';
        if (!id)
            return j({ error: 'Order not found.' }, 404);
        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', id);
        if (!order)
            return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        if (body.refreshTracking === true) {
            if (!data.shipment?.tracking || !data.shipment?.shipmentId) return j({ error: 'This order has no carrier label to check.' }, 400);
            const checked = timestamp();
            const status = await readShipmentTracking(env, data.shipment.shipmentId, data.shipment.tracking);
            await run("UPDATE orders SET data=json_set(data,'$.shipment.status',?,'$.shipment.checkedAt',?),status=CASE WHEN status IN ('paid','shipped') AND ?='delivered' THEN 'delivered' WHEN status='paid' AND ? IN ('in_transit','out_for_delivery','available_for_pickup') THEN 'shipped' ELSE status END,updated=? WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=? AND coalesce(json_extract(data,'$.shipment.checkedAt'),0)<=?", status, checked, status, status, checked, id, data.shipment.shipmentId, checked);
            return j({ message: 'Carrier status checked: ' + status.replaceAll('_', ' ') + '. No email was sent.' });
        }
        if (body.resend === true) {
            if (!data.shipment?.tracking)
                return j({ error: 'This order has no label yet.' }, 400);
            const sent = await sendTrackingEmail(env, data.email || '', order.id, data.shipment, data.address?.name);
            return j({ message: sent ? 'Tracking email accepted by the mail provider. Inbox delivery is not confirmed.' : 'Tracking email could not be sent. Check RESEND_API_KEY and the customer email.' });
        }
        // Claim the order first so a double click cannot buy two labels.
        const claim = await run("UPDATE orders SET status='labeling',updated=? WHERE id=? AND status='paid' AND json_extract(data,'$.shipment') IS NULL", timestamp(), id);
        if (!claim.meta.changes)
            return j({ error: data.shipment ? 'A label was already bought for this order.' : 'Only paid orders without a label can have a label purchased.' }, 409);
        let label;
        try {
            label = await buyLabel(env, data.address, data.items || [], 'BIOMOD ' + id.slice(0, 8));
        }
        catch (e) {
            await run("UPDATE orders SET status='paid',updated=? WHERE id=? AND status='labeling'", timestamp(), id);
            return j({ error: e instanceof Error ? e.message : 'The label could not be bought.' }, 502);
        }
        const next = { ...data, tracking: label.carrier + ' ' + label.tracking, shipment: label, labelCreatedAt: timestamp() };
        await run("UPDATE orders SET status='paid',data=?,updated=? WHERE id=?", JSON.stringify(next), timestamp(), id);
        const emailed = await sendTrackingEmail(env, data.email || '', order.id, label, data.address?.name);
        return j({ message: 'Label created; pack the order and hand it to the carrier. ' + label.service + ', ' + label.tracking + (emailed ? '. Tracking email accepted by the mail provider; delivery is unconfirmed.' : '. Tracking email not sent.'), labelUrl: label.labelUrl });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
