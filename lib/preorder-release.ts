import { orderHasPreorder, preorderReleased } from './fulfillment';
import { fulfillmentBlock } from './fulfillment-eligibility';
import { orderDataVersion } from './order-queue-db';

/** Only audited DB handles call this. The purchased items, prices, lots and estimate never change. */
export async function releasePreorder(db: D1Database, input: { orderId: string; expectedVersion: string; note: string }, actor: string, now = Date.now()) {
    const order = await db.prepare('SELECT status,data FROM orders WHERE id=?').bind(input.orderId).first<{status: string; data: string}>();
    if (!order) throw new Error('Order not found.');
    const data = JSON.parse(order.data);
    if (!orderHasPreorder(data) || preorderReleased(data)) throw new Error('This order is not waiting for preorder release.');
    const blocked = fulfillmentBlock({ status: order.status, data: { ...data, items: [] } });
    if (blocked) throw new Error(blocked);
    if (!actor.trim() || input.note.trim().length < 10) throw new Error('Record who confirmed the ordered stock is ready.');
    if (await orderDataVersion(order.data) !== input.expectedVersion) throw new Error('This order changed. Refresh before confirming stock.');
    const saved = await db.prepare("UPDATE orders SET data=json_set(data,'$.preorderRelease',json(?)),updated=? WHERE id=? AND status=? AND data=?")
        .bind(JSON.stringify({ at: now, by: actor, note: input.note.trim().slice(0, 500) }), now, input.orderId, order.status, order.data).run();
    if (!saved.meta.changes) throw new Error('This order changed. Refresh before confirming stock.');
    return { message: 'Preorder stock confirmed ready for packing. Original purchase terms are preserved. No label was bought and no email was sent.' };
}
