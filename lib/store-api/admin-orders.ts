import { queryOrderPage } from '@/lib/order-queue-db';
import { fulfillmentBlock, fulfillmentEligibleSql } from '@/lib/fulfillment-eligibility';
import { savePreorderPlan } from '@/lib/preorder-plan-save';
import { releasePreorder } from '@/lib/preorder-release';
import { recheckPaidOrder } from '@/lib/payment-verify';
import { orderBucket, canArchive, isArchived, tabForOrder } from '@/lib/order-queue';
import { orderMessageLogs } from '@/lib/order-messages';
import { recordChange } from '@/lib/change-history';
import { z } from 'zod';
import { adminOrderView } from '@/lib/catalog-visibility';
import { catalog } from '@/lib/commerce';
import { one, timestamp, parse, runtime, database } from '@/lib/runtime';
import { reconcile } from '@/lib/checkout';
import { createPaymentAdapter } from '@/lib/payments';
import { coaBlockedItems, coaBlockMessage, noCoaProducts } from '@/lib/coa-shipping';
import type { AdminPostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';

export async function adminOrders(context: AdminPostContext) {
    const { action, b, actor, auditActor, auditEnv, run } = context;
    if (action === 'admin-orders') {
        const result = await queryOrderPage(database(), b);
        const products = await catalog(false, true);
        const messages = await orderMessageLogs(runtime() as any, result.orders as any);
        return j({ ...result, orders: result.orders.map((o: any) => ({ ...o, data: adminOrderView(o.data), messages: messages[o.id] || { count: 0, last: null, items: [] }, coaMissing: ['paid', 'labeling'].includes(o.status) && !o.data?.shipment ? coaBlockedItems(o.data?.items, products) : [] })), noCoa: noCoaProducts(products) });
    }
    if (action === 'admin-order-archive') {
        // Files a finished order out of the working tabs, or puts it back. Changes nothing else:
        // status, payment, label and customer record stay exactly as they were.
        const input = z.object({ orderId: z.string().min(6).max(80), restore: z.boolean().optional() }).parse(b);
        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', input.orderId);
        if (!order) return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        const number = '#' + order.id.slice(0, 8).toUpperCase();
        if (input.restore) {
            if (!isArchived({ data })) return j({ message: number + ' is not archived.' });
            await run("UPDATE orders SET data=json_remove(data,'$.archivedAt','$.archivedBy'),updated=? WHERE id=?", timestamp(), order.id);
            return j({ message: number + ' restored.' });
        }
        if (!canArchive(orderBucket({ status: order.status, data })) || ['review', 'backorder'].includes(tabForOrder({ status: order.status, data }))) return j({ error: number + ' still needs work, so it cannot be archived.' }, 409);
        const archived = await run("UPDATE orders SET data=json_set(data,'$.archivedAt',?,'$.archivedBy',?),updated=? WHERE id=? AND status=? AND data=?", Date.now(), actor.email, timestamp(), order.id, order.status, order.data);
        if (!archived.meta.changes) return j({ error: 'This order changed. Refresh before archiving.' }, 409);
        return j({ message: number + ' archived.' });
    }
    if (action === 'admin-preorder-plan') {
        const input = z.object({ orderId: z.string().uuid(), dispatchDate: z.string().nullable(), note: z.string().trim().min(10).max(500), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(b);
        return j(await savePreorderPlan(auditEnv().DB, input, actor.email));
    }
    if (action === 'admin-preorder-release') {
        const input = z.object({ orderId: z.string().uuid(), note: z.string().trim().min(10).max(500), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).parse(b);
        return j(await releasePreorder(auditEnv().DB, input, actor.email));
    }
    if (action === 'admin-order-handoff') {
        // Records who handed the parcel to the carrier and when. Changes no status and emails
        // nobody: the order moves to Shipped only when the carrier's own scan arrives.
        const input = z.object({ orderId: z.string().min(6).max(80), undo: z.boolean().optional() }).parse(b);
        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', input.orderId);
        if (!order) return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        const number = '#' + order.id.slice(0, 8).toUpperCase();
        if (input.undo) {
            await run("UPDATE orders SET data=json_remove(data,'$.handoff'),updated=? WHERE id=?", timestamp(), order.id);
            return j({ message: 'Drop-off cleared for ' + number + '.' });
        }
        const blocked = fulfillmentBlock({ status: order.status, data });
        if (blocked) return j({ error: blocked }, 409);
        if (!data.shipment?.tracking || !['paid', 'shipped'].includes(order.status)) return j({ error: number + ' has no label to drop off.' }, 409);
        const saved = await run(`UPDATE orders SET data=json_set(data,'$.handoff',json(?)),updated=? WHERE id=? AND status IN ('paid','shipped') AND json_extract(data,'$.shipment.tracking') IS NOT NULL AND json_extract(data,'$.handoff') IS NULL AND ${fulfillmentEligibleSql} AND data=?`, JSON.stringify({ at: Date.now(), by: actor.email }), timestamp(), order.id, order.data);
        if (!saved.meta.changes) return j({ error: 'This order changed or was already marked dropped off. Refresh its current record.' }, 409);
        return j({ message: number + ' marked dropped off. It moves to Shipped when the carrier scans it.' });
    }
    if (action === 'admin-reconcile') {
        const o = await one<{ owner: string; status: string }>('SELECT owner,status FROM orders WHERE id=?', str(b.id, 50));
        if (!o)
            throw new Error('Order not found.');
        if (['paid', 'labeling', 'shipped', 'delivered'].includes(o.status)) return j(await recheckPaidOrder(auditEnv(), str(b.id, 50)));
        return j(await reconcile(o.owner, b.id, [], auditActor));
    }
    if (action === 'admin-payment-hold') {
        const orderId = str(b.id, 50);
        const decision = z.enum(['approve', 'decline']).parse(b.decision);
        const transId = z.string().regex(/^\d{1,20}$/).parse(b.transId);
        const o = await one<{ owner: string; total: number; status: string }>('SELECT owner,total,status FROM orders WHERE id=?', orderId);
        if (!o) throw new Error('Order not found.');
        if (['paid', 'labeling', 'shipped', 'delivered'].includes(o.status)) throw new Error('This order is already paid.');
        const adapter = createPaymentAdapter(runtime());
        if (adapter.provider !== 'authorizenet') throw new Error('Approving held payments works only with Authorize.net.');
        const record = (status: 'attempted' | 'succeeded' | 'failed', summary: string) => recordChange(database(), { source: 'admin', actor: actor.email, actorType: 'staff', action: 'payment.held_' + decision, entityType: 'order', entityId: orderId, summary, status, changes: [] }).catch(() => undefined);
        await record('attempted', (decision === 'approve' ? 'Approve' : 'Decline') + ' held Authorize.net transaction ' + transId + '.');
        try { await adapter.decideHeld({ id: orderId, totalCents: o.total, currency: 'USD' }, transId, decision); }
        catch (e) { await record('failed', 'Authorize.net did not accept the ' + decision + ': ' + (e instanceof Error ? e.message : 'unknown error')); throw e; }
        await record('succeeded', 'Authorize.net accepted the ' + decision + ' of transaction ' + transId + '.');
        const checked = await reconcile(o.owner, orderId, [transId], auditActor).catch(() => null);
        return j({ ...(checked || {}), message: decision === 'approve'
            ? (checked?.status === 'paid' ? 'Approved. The payment is collected and the order moved to To ship.' : 'Approved at Authorize.net. Press Check payment in a minute if the order has not moved to To ship.')
            : 'Declined. The customer is not charged and the hold on their card is released.' });
    }
    if (action === 'admin-order') {
        const status = z.enum(['shipped', 'delivered']).parse(b.status);
        // One id for both statements. Reading with a trimmed value and writing with the raw one
        // let a padded id report success while matching no row at all.
        const orderId = str(b.id, 50);
        const o = await one<{
            data: string;
            status: string;
        }>('SELECT data,status FROM orders WHERE id=?', orderId);
        if (!o || !['paid', 'shipped'].includes(o.status))
            throw new Error('Only verified paid orders may be fulfilled.');
        const blocked = fulfillmentBlock({ status: o.status, data: parse<Record<string, any>>(o.data, {}) });
        if (blocked) throw new Error(blocked);
        // A tracked parcel is delivered when the carrier says so, never by hand: a store claim
        // over a parcel the carrier never scanned is how a lost box goes unnoticed.
        const carrierShipment = parse<Record<string, any>>(o.data, {}).shipment;
        if (status === 'delivered' && carrierShipment?.tracking && carrierShipment.status !== 'delivered')
            throw new Error('The carrier has not confirmed delivery. Tracked orders move to Delivered by themselves when the carrier scans the delivery.');
        if (status === 'shipped' && o.status === 'paid') {
            const blocked = coaBlockedItems(parse<Record<string, any>>(o.data, {}).items, await catalog(false, true));
            if (blocked.length) throw new Error(coaBlockMessage(blocked));
        }
        // Targeted write, guarded on the status we read. A carrier update or a bought label that
        // landed in between is preserved, and a lost race is reported rather than announced as success.
        const saved = await run(`UPDATE orders SET status=?,data=json_set(data,'$.tracking',?),updated=? WHERE id=? AND status=? AND ${fulfillmentEligibleSql} AND data=?`, status, str(b.tracking, 200), timestamp(), orderId, o.status, o.data);
        if (!saved.meta.changes) throw new Error('This order changed while you were working on it. Refresh and try again.');
        return j({ message: 'Order updated.' });
    }
}

