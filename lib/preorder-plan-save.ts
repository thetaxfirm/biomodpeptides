import { canPlanPreorder, validDispatchDate, type PreorderPlan } from './preorder-plan';
import { orderDataVersion } from './order-queue-db';

/** Caller supplies the authenticated actor and an audited DB. No provider or notification calls. */
export async function savePreorderPlan(db: D1Database, input: { orderId: string; expectedVersion: string; dispatchDate: string | null; note: string }, actor: string, now = Date.now()) {
    if (!actor.trim() || actor.length > 320) throw new Error('An authenticated staff owner is required.');
    if (input.dispatchDate !== null && (!validDispatchDate(input.dispatchDate) || input.dispatchDate < new Date(now).toISOString().slice(0, 10))) throw new Error('Use today or a future dispatch date (UTC), or leave it blank until confirmed.');
    if (input.note.trim().length < 10 || input.note.trim().length > 500) throw new Error('Record the estimate check in 10 to 500 characters.');
    const order = await db.prepare('SELECT status,data FROM orders WHERE id=?').bind(input.orderId).first<{status: string; data: string}>();
    if (!order) throw new Error('Order not found.');
    const data = JSON.parse(order.data);
    if (!canPlanPreorder({ status: order.status, data })) throw new Error('This order is not awaiting preorder stock.');
    if (await orderDataVersion(order.data) !== input.expectedVersion) throw new Error('This order changed. Refresh before saving the estimate.');
    const plan: PreorderPlan = { dispatchDate: input.dispatchDate, owner: actor, confirmedBy: actor, confirmedAt: now, note: input.note.trim() };
    const saved = await db.prepare("UPDATE orders SET data=json_set(data,'$.preorderPlan',json(?)),updated=? WHERE id=? AND status=? AND data=?")
        .bind(JSON.stringify(plan), now, input.orderId, order.status, order.data).run();
    if (!saved.meta.changes) throw new Error('This order changed. Refresh before saving the estimate.');
    return { message: 'Current preorder estimate saved and assigned to you. Original purchase terms and stock release are unchanged.' };
}
