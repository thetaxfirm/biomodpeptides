import { orderPaymentStatus, orderShipmentStatus, preorderAwaitingRelease } from '@/lib/fulfillment';
import { savedPaymentCheck } from '@/lib/payment-check';
import { issueLabel } from '@/lib/request-issues';

/** Keep money, physical shipment and the support decision distinct in one review. */
export function OrderResolution({ order }: { order: any }) {
    const data = order.data || {}, payment = orderPaymentStatus(order), shipment = orderShipmentStatus(order);
    const refunds = savedPaymentCheck(data.paymentCheck)?.attempts.filter(attempt => attempt.kind === 'refunded') || [];
    return <section aria-label="Order resolution">
        <h3>Order resolution</h3>
        <dl>
            <dt>Payment</dt><dd>{payment.label}. {data.paymentVerified?.why || payment.detail}</dd>
            <dt>Parcel</dt><dd>{shipment.label}. {shipment.detail}</dd>
            <dt>Work remaining</dt><dd>{data.hold ? 'On hold: ' + issueLabel(data.hold.issue) + (data.hold.note ? '. ' + data.hold.note : '') : preorderAwaitingRelease(data) ? 'Awaiting stock confirmation and preorder release.' : data.preorderRelease ? 'Preorder stock released for packing. ' + data.preorderRelease.note : 'Review the payment and parcel evidence before choosing an action.'}</dd>
            <dt>Refund evidence</dt><dd>{refunds.length ? refunds.map(attempt => <p key={attempt.transId}>{attempt.words} · provider reference {attempt.transId}{attempt.amountCents !== null ? ' · $' + (attempt.amountCents / 100).toFixed(2) : ''}</p>) : order.status === 'refunded' ? 'This order is recorded as refunded. Provider refund evidence is not attached here.' : 'No provider refund evidence is recorded here.'}</dd>
        </dl>
        <p>Recording a support resolution does not issue a refund or cancel postage. Verify money at the payment provider, preserve parcel history below, and record the customer outcome in the linked conversation.</p>
    </section>;
}
