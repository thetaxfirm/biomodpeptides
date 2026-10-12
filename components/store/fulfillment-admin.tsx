
'use client';
import { useRef, useState } from 'react';
import styles from './shipping-help.module.css';
import { fulfillmentLabel, needsFulfillmentAttention, type FulfillmentOrder } from '@/lib/fulfillment';
export function FulfillmentQueue({ orders }: { orders: (FulfillmentOrder & { id: string; created: number })[] }) {
    const queue = orders.filter(needsFulfillmentAttention).sort((a, b) => a.created - b.created);
    return <section aria-label="Fulfillment queue" className="account-record">
        <h3>Las Vegas fulfillment queue ({queue.length})</h3>
        <p>Paid records needing packing, carrier handoff or review. Check older orders and exclude internal tests before shipping.</p>
        <p>Pack the ordered items and applicable original COA. Print and attach the label, then arrange pickup or drop-off. Buying a label does not schedule a pickup.</p>
        {queue.length ? <ul>{queue.map(order => <li key={order.id}><a href={'#order-' + order.id}>Order {order.id.slice(0, 8)}</a>: {fulfillmentLabel(order)}</li>)}</ul> : <p>No orders requiring fulfillment review in this loaded order list.</p>}
        <p>Based on the loaded orders. Only carrier scans confirm mailing.</p>
    </section>;
}
export function CarrierConnection() {
    const [busy, setBusy] = useState(false);
    const checking = useRef(false);
    const [result, setResult] = useState<{ configured: boolean; connected: boolean; checkedAt: string; webhookConfigured: boolean; webhookRegistered: boolean | null } | null>(null);
    const [error, setError] = useState('');
    async function check() {
        if (checking.current) return;
        checking.current = true; setBusy(true); setError(''); setResult(null);
        try {
            const response = await fetch('/api/admin/shipping', { cache: 'no-store', credentials: 'same-origin' });
            const data = await response.json() as { configured: boolean; connected: boolean; checkedAt: string; webhookConfigured: boolean; webhookRegistered: boolean | null };
            if (!response.ok || typeof data.connected !== 'boolean' || typeof data.configured !== 'boolean' || typeof data.checkedAt !== 'string') throw Error('Carrier check unavailable.');
            setResult(data);
        } catch { setError('Connection status is unavailable. Sign in again if your session expired, then retry. No label was bought.'); }
        finally { checking.current = false; setBusy(false); }
    }
    return <section className={styles.panel} aria-labelledby="easypost-title">
        <h3 id="easypost-title">EasyPost shipping, inside your store</h3>
        <p>EasyPost connects BIOMOD to USPS and UPS for shipping rates, postage labels and carrier tracking. Work from the orders below; you do not need to open the EasyPost dashboard for those tasks.</p>
        <div className={styles.connection}>
            <div><h4>Is the API connected?</h4><p aria-live="polite">{busy ? 'Checking EasyPost now…' : error || (result ? result.connected ? 'Connected: EasyPost accepted the API request.' : result.configured ? 'Configured, but the connection could not be verified.' : 'Not configured: a shipping API key is required.' : 'Not checked in this view. A saved API key alone does not confirm a working connection.')}</p>
            {result && <><p className={styles.note}>Checked {new Date(result.checkedAt).toLocaleString()}. This verifies API access, not production mode, account funding, a successful postage purchase or carrier pickup.</p><p><strong>Automatic tracking:</strong> {!result.webhookConfigured ? 'Signing secret not configured.' : result.webhookRegistered === null ? 'Registration could not be checked.' : result.webhookRegistered ? 'Webhook registered and signing secret configured. Successful event delivery is not yet proven by this check.' : 'No active webhook registration found for this store.'}</p></>}
            </div><button type="button" className="button button-dark" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check EasyPost connection'}</button>
        </div>
        <h4>From payment to delivery</h4>
        <ol className={styles.workflow}>
            <li><strong>Review the paid order.</strong> Confirm the items, shipping address and any applicable original COA. Exclude internal tests. Pending payment is not ready to ship.</li>
            <li><strong>The Las Vegas team packs the box.</strong> Check the contents before buying postage. Current label pricing uses configured box and weight estimates; custom parcel measurements are not editable here yet.</li>
            <li><strong>Buy and print the label here.</strong> Use Buy shipping label on a paid order without a label. This charges the connected EasyPost account for postage, not the customer’s card. Open Show label to preview an existing label without leaving Admin. Do not buy another label just to print again.</li>
            <li><strong>Hand the parcel to USPS or UPS.</strong> Arrange a pickup or drop-off separately. This Admin does not book pickups, and EasyPost does not pack or collect the box automatically.</li>
            <li><strong>Check its progress here.</strong> Use Check carrier status on the order. Resend tracking email sends another customer email; it does not arrange shipping. Mail-provider acceptance does not confirm inbox delivery.</li>
        </ol>
        <details className={styles.help}><summary>What each shipping status means</summary><dl>
            <dt>Payment confirmed</dt><dd>The store recorded payment. Packing and dispatch still need attention.</dd>
            <dt>Label created / pre-transit</dt><dd>Postage exists, but carrier acceptance is not confirmed. A label is not evidence the box was mailed.</dd>
            <dt>In transit / out for delivery</dt><dd>The carrier reports movement. Check the observation time shown on the order.</dd>
            <dt>Delivered</dt><dd>Carrier-confirmed delivery is distinguished from a manual store confirmation.</dd>
            <dt>Failure / return to sender</dt><dd>Review the carrier status and order before taking action. Do not automatically buy replacement postage.</dd>
        </dl></details>
        <details className={styles.help}><summary>Connection problems, charges and tasks that still need the provider</summary>
            <p>If the connection check fails, labels and rates may be unavailable. A failed check does not erase an existing label. Keep existing labels and verify the account before retrying purchases.</p>
            <p>If a label purchase times out or says it may have succeeded, stop and check the existing shipment with the account owner before retrying. The account can have a charge even when the browser did not receive the label.</p>
            <p>Account funding, carrier contracts, postage refunds and pickup booking are not available in this Admin yet. Those require the account owner or carrier. Checkout shipping charges and the actual postage bill can differ; label purchase currently selects the cheapest allowed USPS/UPS rate at that time.</p>
            <p>Connection checks and Check carrier status do not buy postage or send customer emails. Only use the purchase or resend button when you intend that action.</p>
        </details>
    </section>;
}
