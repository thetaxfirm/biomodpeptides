import { currentDispatchEstimate } from '@/lib/sales';
import { savedPreorderPlan, preorderPlanOverdue } from '@/lib/preorder-plan';
import { orderPaymentStatus, orderShipmentStatus, preorderAwaitingRelease, orderHasPreorder, savedPreorder } from '@/lib/fulfillment';
import { savedPaymentCheck } from '@/lib/payment-check';
import { issueLabel } from '@/lib/request-issues';

/** Keep money, physical shipment and the support decision distinct in one review. */
export function OrderResolution({ order }: { order: any }) {
    const data = order.data || {}, payment = orderPaymentStatus(order), shipment = orderShipmentStatus(order);
    const plan = savedPreorderPlan(data.preorderPlan);
    const purchasedEstimates = Array.isArray(data.items) ? [...new Set(data.items.map((item: any) => savedPreorder(item?.product?.activePreorder)?.ships).filter(Boolean))].join(' / ') : '';
    const refunds = savedPaymentCheck(data.paymentCheck)?.attempts.filter(attempt => attempt.kind === 'refunded') || [];
    return <section aria-label="Order resolution">
        <h3>Order resolution</h3>
        <dl>
            <dt>Payment</dt><dd>{payment.label}. {data.paymentVerified?.why || payment.detail}</dd>
            <dt>Parcel</dt><dd>{shipment.label}. {shipment.detail}</dd>
            <dt>Work remaining</dt><dd>{data.hold ? 'On hold: ' + issueLabel(data.hold.issue) + (data.hold.note ? '. ' + data.hold.note : '') : preorderAwaitingRelease(data) ? 'Awaiting stock confirmation and preorder release.' : data.preorderRelease ? 'Preorder stock released for packing. ' + data.preorderRelease.note : 'Review the payment and parcel evidence before choosing an action.'}</dd>
            <dt>Refund evidence</dt><dd>{refunds.length ? refunds.map(attempt => <p key={attempt.transId}>{attempt.words} · provider reference {attempt.transId}{attempt.amountCents !== null ? ' · $' + (attempt.amountCents / 100).toFixed(2) : ''}</p>) : order.status === 'refunded' ? 'This order is recorded as refunded. Provider refund evidence is not attached here.' : 'No provider refund evidence is recorded here.'}</dd>
        </dl>
        {orderHasPreorder(data) && <div>
            <h3>Preorder dispatch plan</h3>
            <dl>
                <dt>Original purchase estimate</dt><dd>{purchasedEstimates}</dd>
                {preorderAwaitingRelease(data) && !plan && Array.isArray(data.items) && data.items.some((item: any) => { const promise = savedPreorder(item?.product?.activePreorder)?.ships; return promise && currentDispatchEstimate(promise) !== promise; }) && <><dt>Estimate review</dt><dd>Original estimate has passed. Confirm a revised date and take ownership.</dd></>}
                <dt>Current dispatch estimate</dt><dd>{plan?.dispatchDate || 'Awaiting confirmed dispatch date'}{preorderAwaitingRelease(data) && preorderPlanOverdue(plan) && <strong> · Estimate overdue. Check stock and revise the plan.</strong>}</dd>
                <dt>Estimate owner</dt><dd>{plan?.owner || 'Unassigned'}</dd>
                <dt>Last checked (UTC)</dt><dd>{plan ? new Date(plan.confirmedAt).toISOString().replace('T', ' ').slice(0, 16) + ' · ' + plan.confirmedBy : 'Not recorded'}</dd>
            </dl>
            {plan && <p>{plan.note}</p>}
            <p>A revised estimate does not confirm stock readiness or release this order for packing.</p>
        </div>}
        <p>Recording a support resolution does not issue a refund or cancel postage. Verify money at the payment provider, preserve parcel history below, and record the customer outcome in the linked conversation.</p>
    </section>;
}
