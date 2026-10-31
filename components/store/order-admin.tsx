'use client';
import { money } from '@/lib/catalog';
import { savedPreorder, orderPreorderNotice } from '@/lib/fulfillment';
import { addressProblem, savedAddressCheck, staffAddressLabel } from '@/lib/address-check';
// Full order for the admin Orders tab: who ordered, every item and quantity, and how the total was reached.
const packLabel = (i: any) => i.packSize ? (i.packKind === 'fixed' ? 'Fixed ' : 'Mixed ') + i.packSize + '-pack' : '';
export function OrderDetails({ order }: { order: any }) {
    const d = order.data || {};
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    const units = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const num = (v: unknown) => Number.isSafeInteger(v) ? v as number : 0;
    const addressCheck = savedAddressCheck(d.addressCheck);
    return <div className="order-details">
        <p><strong>Customer:</strong> {d.address?.name || 'Not recorded'}{d.email && <> · <a href={'mailto:' + d.email}>{d.email}</a></>}{d.address?.phone && <> · <a href={'tel:' + String(d.address.phone).replace(/[^0-9+]/g, '')}>{d.address.phone}</a></>}</p>
        <p><strong>Ship to:</strong> {d.address?.line1}{d.address?.line2 ? ', ' + d.address.line2 : ''}, {d.address?.city} {d.address?.state} {d.address?.zip}</p>
        {addressCheck && <p className={addressProblem(addressCheck) ? 'notice' : 'muted'}>{staffAddressLabel(addressCheck)}.</p>}
        {orderPreorderNotice(d) && <p className="notice">{orderPreorderNotice(d)}</p>}
        <table className="order-items">
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Line total</th></tr></thead>
            <tbody>{items.length ? items.map((i, n) => <tr key={n}><td>{i.product?.name || 'Product ' + i.id}{packLabel(i) && <small> · {packLabel(i)}</small>}{i.presaleId && <small> · Presale</small>}{i.product?.soldBatch && <small style={{display:'block'}}>Ordered lot: {i.product.soldBatch.lot || 'Not recorded'} · COA: {i.product.soldBatch.coaAvailable ? i.product.soldBatch.reportId || 'Original available' : 'Unavailable at purchase'}</small>}{savedPreorder(i.product?.activePreorder) && <small> · Preorder · {i.product.activePreorder.percentOff}% off included</small>}</td><td>{i.quantity}</td><td>{Number.isSafeInteger(i.product?.price) ? money(i.product.price) : '—'}</td><td>{money(num(i.lineTotal))}</td></tr>) : <tr><td colSpan={4}>No items recorded on this order.</td></tr>}</tbody>
            <tfoot>
                <tr><td colSpan={3}>Subtotal ({units} unit{units === 1 ? '' : 's'})</td><td>{money(num(d.subtotal))}</td></tr>
                {num(d.discount) > 0 && <tr><td colSpan={3}>Discounts{d.promo?.code ? ' (incl. promo ' + d.promo.code + ')' : ''}</td><td>−{money(num(d.discount))}</td></tr>}
                <tr><td colSpan={3}>Shipping{d.shippingService ? ' · ' + d.shippingService : ''}{d.shippingOption?.serviceKey && d.shippingOption.carrier ? ' (' + d.shippingOption.carrier + ' ' + String(d.shippingOption.carrierService || '').replaceAll('_', ' ') + ')' : ''}</td><td>{money(num(d.shipping))}</td></tr>
                <tr><td colSpan={3}>Tax</td><td>{money(num(d.tax))}</td></tr>
                <tr className="order-total"><td colSpan={3}>Total</td><td>{money(num(d.total ?? order.total))}</td></tr>
            </tfoot>
        </table>
    </div>;
}
