import { NextRequest, NextResponse } from 'next/server';
import { fulfillmentBlock } from '@/lib/fulfillment-eligibility';
import { requireStaff } from '@/lib/auth';
import { easypostReady } from '@/lib/easypost';
import { readTrackingCode } from '@/lib/easypost-tracker';
import { one, parse, runtime, timestamp } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
export const dynamic = 'force-dynamic';

const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const auditWarning = ' Change history could not record the final result. Do not repeat this action just to update history.';

/**
 * Records a replacement parcel sent outside this store (owner, Nov 17 2026: Trista's and Kim's
 * orders were reshipped and the new labels were bought elsewhere, so the orders still showed the
 * failed and unscanned originals).
 *
 * The carrier decides, not the person typing. The tracking number is checked against EasyPost
 * first, and whatever EasyPost says becomes the order's shipment status -- so this cannot be used
 * to declare a parcel delivered that the carrier has never seen. That is the same rule the manual
 * fulfilment form follows, and the reason a reship needed its own path rather than a free-text
 * tracking field.
 *
 * The original shipment is kept under previousShipment. A failed first parcel is part of the
 * order's history and the label may still need to be reprinted or claimed against.
 *
 * Buys nothing, voids nothing, and emails nobody: the customer was already told by whoever sent
 * the replacement.
 */
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin)
        return j({ error: 'Please refresh the page and try again.' }, 403);
    let actor;
    try { actor = await requireStaff('orders:fulfill'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }

    try {
        const env = runtime();
        const context = { source: 'admin' as const, actor: actor.email, actorType: 'staff' as const, action: 'order.reship' };
        const run = (sql: string, ...values: (string | number | null)[]) => auditRun(env.DB, context, sql, ...values);
        if (!easypostReady(env))
            return j({ error: 'EasyPost is not connected, so a replacement tracking number cannot be verified.' }, 400);

        const body = await req.json().catch(() => ({})) as { orderId?: unknown; tracking?: unknown; carrier?: unknown; note?: unknown };
        const orderId = typeof body.orderId === 'string' && /^[a-f0-9-]{36}$/.test(body.orderId) ? body.orderId : '';
        if (!orderId) return j({ error: 'Choose an order.' }, 400);
        const asked = typeof body.tracking === 'string' ? body.tracking.trim().toUpperCase() : '';
        if (!asked) return j({ error: 'Enter the replacement tracking number.' }, 400);
        const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : '';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', orderId);
        if (!order) return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        const number = '#' + order.id.slice(0, 8).toUpperCase();
        // A replacement only makes sense for an order that was paid for. An unpaid or under-review
        // order has no parcel to replace, and recording one would assert a sale that never happened.
        if (!['paid', 'shipped', 'delivered'].includes(order.status))
            return j({ error: number + ' is not a paid order, so it has no parcel to replace.' }, 409);
        const blocked = fulfillmentBlock({ status: order.status, data });
        if (blocked) return j({ error: blocked }, 409);
        const previous = data.shipment && typeof data.shipment === 'object' ? data.shipment as Record<string, any> : null;
        if (previous && String(previous.tracking || '').toUpperCase() === asked)
            return j({ message: number + ' already carries that tracking number.' });

        const record = async (status: 'attempted' | 'succeeded' | 'failed', summary: string, changes: { field: string; before: string | number | boolean; after: string | number | boolean }[] = []) => {
            try { await recordChange(env.DB, { ...context, entityType: 'order', entityId: order.id, status, summary, changes }); return true; }
            catch { return false; }
        };
        await record('attempted', 'Requested to record a replacement parcel on ' + number + '.' + (note ? ' ' + note : ''));

        let tracked;
        try { tracked = await readTrackingCode(env, asked, carrier || undefined); }
        catch (error) {
            const why = error instanceof Error ? error.message : 'Carrier tracking could not be verified.';
            await record('failed', 'Replacement tracking for ' + number + ' was not accepted by the carrier. Nothing was saved.');
            return j({ error: why + ' No order changes were saved.' }, 400);
        }

        const checked = timestamp();
        // The order's status follows the carrier, never the request. Delivered only when the
        // carrier says delivered; a parcel still in transit leaves a paid order shipped.
        const next = tracked.status === 'delivered' ? 'delivered'
            : ['in_transit', 'out_for_delivery', 'available_for_pickup'].includes(tracked.status) && order.status === 'paid' ? 'shipped'
            : order.status;
        const shipment = {
            tracking: tracked.tracking,
            status: tracked.status,
            service: tracked.carrier || (previous?.service ?? ''),
            trackingUrl: tracked.trackingUrl,
            ...(tracked.shipmentId ? { shipmentId: tracked.shipmentId } : {}),
            checkedAt: checked,
            sweptAt: checked,
            reshipAt: checked,
            reshipBy: actor.email,
            ...(note ? { reshipNote: note } : {}),
        };
        // One statement, guarded on the status just read and on the tracking number that was
        // there: a carrier update or a second reship that landed in between is preserved and the
        // lost race is reported, rather than this quietly overwriting it.
        const saved = await run(
            "UPDATE orders SET status=?,data=json_set(json_set(data,'$.previousShipment',COALESCE(json_extract(data,'$.shipment'),json('null'))),'$.shipment',json(?),'$.tracking',?),updated=? WHERE id=? AND status=? AND COALESCE(json_extract(data,'$.shipment.tracking'),'')=? AND data=?",
            next, JSON.stringify(shipment), tracked.tracking, timestamp(), order.id, order.status, String(previous?.tracking || ''), order.data);
        if (!saved.meta.changes) {
            await record('failed', number + ' changed while this was being saved. Nothing was written.');
            return j({ error: 'This order changed while you were working on it. Refresh and try again.' }, 409);
        }
        const words = tracked.status.replaceAll('_', ' ');
        const recorded = await record('succeeded',
            'Replacement parcel recorded on ' + number + '. The carrier reports ' + words + '.',
            [{ field: 'shipment.tracking', before: String(previous?.tracking || ''), after: tracked.tracking },
             { field: 'shipment.status', before: String(previous?.status || ''), after: tracked.status },
             { field: 'status', before: order.status, after: next }]);
        return j({ message: 'Replacement recorded on ' + number + '. The carrier reports ' + words + '.'
            + (next !== order.status ? ' The order is now ' + next + '.' : '')
            + ' The first parcel is kept in the record. No email was sent.' + (recorded ? '' : auditWarning),
            status: tracked.status, orderStatus: next });
    }
    catch { return j({ error: 'That could not be saved. Nothing was changed.' }, 400); }
}
