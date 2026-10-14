import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { buyLabel, easypostReady, sendTrackingEmail, shippingConnection, readShipmentTracking } from '@/lib/easypost';
import { one, parse, runtime, timestamp } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
import { savedShippingOption } from '@/lib/shipping-options';
import { catalog, config } from '@/lib/commerce';
import { coaBlockedItems, coaBlockMessage } from '@/lib/coa-shipping';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const auditWarning = ' Change history could not record the final result. Do not repeat this action just to update history.';
// Label creation does not confirm dispatch. All provider calls require administrator access.
export async function GET() {
    try { await requireStaff('orders:read'); return j(await shippingConnection(runtime())); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
}
export async function POST(req: NextRequest) {
    try {
        if (req.headers.get('origin') !== req.nextUrl.origin)
            return j({ error: 'Please refresh the page and try again.' }, 403);
        const actor = await requireStaff('orders:fulfill');
        const env = runtime();
        const context = { source: 'admin' as const, actor: actor.email, actorType: 'staff' as const };
        const run = (sql: string, ...values: (string | number | null)[]) => auditRun(env.DB, context, sql, ...values);
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
        const record = (action: string, status: 'attempted' | 'succeeded' | 'failed' | 'observed', summary: string) => recordChange(env.DB, {
            ...context, action, entityType: 'order', entityId: id, summary, status, changes: [],
        });
        // An external action and D1 cannot share a transaction. An attempted event must
        // be durable first; a missing outcome must never cause the external action to repeat.
        const outcome = async (action: string, status: 'succeeded' | 'failed' | 'observed', summary: string) => {
            try { await record(action, status, summary); return true; }
            catch { return false; }
        };
        const trackingEmail = async (label: Parameters<typeof sendTrackingEmail>[3]) => {
            await record('shipping.tracking_email', 'attempted', 'Requested a tracking email.');
            let sent = false;
            try { sent = await sendTrackingEmail(env, data.email || '', order.id, label, data.address?.name); }
            catch { /* The provider outcome is unknown; do not repeat the send. */ }
            const recorded = await outcome('shipping.tracking_email', sent ? 'succeeded' : 'observed', sent
                ? 'Tracking email accepted by the mail provider. Inbox delivery is unconfirmed.'
                : 'Tracking email acceptance was not confirmed. Review mail provider records before resending.');
            return { sent, recorded };
        };
        if (body.refreshTracking === true) {
            if (!data.shipment?.tracking || !data.shipment?.shipmentId) return j({ error: 'This order has no carrier label to check.' }, 400);
            await record('shipping.refresh_tracking', 'attempted', 'Requested a read-only carrier tracking check.');
            const checked = timestamp();
            let status: string;
            try { status = await readShipmentTracking(env, data.shipment.shipmentId, data.shipment.tracking); }
            catch {
                const recorded = await outcome('shipping.refresh_tracking', 'failed', 'Carrier tracking could not be verified. No order changes were saved.');
                return j({ error: 'Carrier tracking could not be verified. No order changes were saved.' + (recorded ? '' : auditWarning) }, 400);
            }
            const saved = await run("UPDATE orders SET data=json_set(data,'$.shipment.status',?,'$.shipment.checkedAt',?),status=CASE WHEN status IN ('paid','shipped') AND ?='delivered' THEN 'delivered' WHEN status='paid' AND ? IN ('in_transit','out_for_delivery','available_for_pickup') THEN 'shipped' ELSE status END,updated=? WHERE id=? AND json_extract(data,'$.shipment.shipmentId')=? AND coalesce(json_extract(data,'$.shipment.checkedAt'),0)<=?", status, checked, status, status, checked, id, data.shipment.shipmentId, checked);
            const recorded = await outcome('shipping.refresh_tracking', saved.meta.changes ? 'succeeded' : 'observed', saved.meta.changes
                ? 'Carrier tracking verified and saved. No email was sent.'
                : 'Carrier tracking checked; a newer stored observation or changed shipment was preserved. No email was sent.');
            return j({ message: (saved.meta.changes ? 'Carrier status checked: ' + status.replaceAll('_', ' ') + '.' : 'Carrier checked; a newer observation or changed shipment was preserved.') + ' No email was sent.' + (recorded ? '' : auditWarning) });
        }
        if (body.resend === true) {
            if (!data.shipment?.tracking)
                return j({ error: 'This order has no label yet.' }, 400);
            const result = await trackingEmail(data.shipment);
            return j({ message: (result.sent ? 'Tracking email accepted by the mail provider. Inbox delivery is not confirmed.' : 'Tracking email acceptance was not confirmed. Check mail provider records before resending.') + (result.recorded ? '' : auditWarning) });
        }
        const coaBlocked = coaBlockedItems(data.items, await catalog(false, true));
        if (coaBlocked.length) return j({ error: coaBlockMessage(coaBlocked) + ' No label was bought.' }, 409);
        await record('shipping.label_purchase', 'attempted', 'Requested a carrier label purchase.');
        // Claim the order first so a double click cannot buy two labels.
        if (data.hold) return j({ error: 'This order is on hold for a reported problem. Clear the hold before buying a label.' }, 409);
        const claim = await run("UPDATE orders SET status='labeling',updated=? WHERE id=? AND status='paid' AND json_extract(data,'$.shipment') IS NULL AND json_extract(data,'$.hold') IS NULL", timestamp(), id);
        if (!claim.meta.changes) {
            await outcome('shipping.label_purchase', 'failed', 'Label purchase stopped because the order was not eligible. No provider purchase was attempted.');
            return j({ error: data.shipment ? 'A label was already bought for this order.' : 'Only paid orders without a label can have a label purchased.' }, 409);
        }
        let label;
        try {
            const selected = savedShippingOption(data.shippingOption);
            if (data.shippingOption && !selected) throw new Error('The saved shipping option needs review before buying a label.');
            label = await buyLabel(env, data.address, data.items || [], 'BIOMOD ' + id.slice(0, 8), selected || { shippingService: data.shippingService }, (await config()).shippingOptions);
        }
        catch (e) {
            await run("UPDATE orders SET status='paid',updated=? WHERE id=? AND status='labeling'", timestamp(), id);
            const recorded = await outcome('shipping.label_purchase', 'observed', 'A label purchase result was not confirmed. Review the carrier account before retrying.');
            return j({ error: (e instanceof Error ? e.message : 'The label could not be bought.') + ' Review the carrier account before retrying.' + (recorded ? '' : auditWarning) }, 502);
        }
        const next = { ...data, tracking: label.carrier + ' ' + label.tracking, shipment: label, labelCreatedAt: timestamp() };
        try { await run("UPDATE orders SET status='paid',data=?,updated=? WHERE id=?", JSON.stringify(next), timestamp(), id); }
        catch {
            await outcome('shipping.label_purchase', 'observed', 'The carrier returned a label, but saving its order record failed. Review the existing carrier label; do not buy another.');
            return j({ error: 'The carrier returned a label, but the order could not save it. Do not buy another label. Review the existing label in EasyPost.', labelUrl: label.labelUrl }, 502);
        }
        const recorded = await outcome('shipping.label_purchase', 'succeeded', 'Carrier label purchased and saved. Packing and carrier handoff are still required.');
        let emailMessage: string;
        try {
            const result = await trackingEmail(label);
            emailMessage = (result.sent ? '. Tracking email accepted by the mail provider; delivery is unconfirmed.' : '. Tracking email acceptance was not confirmed. Check mail provider records before resending.') + (result.recorded ? '' : auditWarning);
        }
        catch { emailMessage = '. Tracking email was not attempted because its history record could not be saved.'; }
        return j({ message: 'Label created; pack the order and hand it to the carrier. ' + label.service + ', ' + label.tracking + emailMessage + (recorded ? '' : auditWarning), labelUrl: label.labelUrl });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
