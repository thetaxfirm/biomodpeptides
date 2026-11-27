import { preorderAwaitingRelease, type FulfillmentOrder } from './fulfillment';

/** Current staff estimate, separate from immutable purchased line promises and stock release. */
export type PreorderPlan = { dispatchDate: string | null; owner: string; confirmedAt: number; confirmedBy: string; note: string };
export function validDispatchDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
export function savedPreorderPlan(value: unknown): PreorderPlan | null {
    if (!value || typeof value !== 'object') return null;
    const p = value as Partial<PreorderPlan>;
    if (p.dispatchDate !== null && !validDispatchDate(p.dispatchDate)) return null;
    if (typeof p.owner !== 'string' || !p.owner.trim() || typeof p.confirmedBy !== 'string' || !p.confirmedBy.trim() || typeof p.confirmedAt !== 'number' || !Number.isFinite(p.confirmedAt) || !Number.isFinite(new Date(p.confirmedAt).getTime()) || p.confirmedAt <= 0 || typeof p.note !== 'string' || !p.note.trim()) return null;
    return p as PreorderPlan;
}
export function preorderPlanOverdue(value: unknown, now = Date.now()): boolean {
    const plan = savedPreorderPlan(value);
    return Boolean(plan?.dispatchDate && plan.dispatchDate < new Date(now).toISOString().slice(0, 10));
}
export function canPlanPreorder(order: FulfillmentOrder): boolean {
    const carrier = order.data?.shipment?.status;
    return preorderAwaitingRelease(order.data) && order.status === 'paid' && !order.data?.internalTest && !order.data?.handoff && !order.data?.tracking && (!carrier || ['pre_transit', 'unknown'].includes(carrier));
}
