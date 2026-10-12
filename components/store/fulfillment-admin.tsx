
'use client';
import { useState } from 'react';
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
    const [message, setMessage] = useState('');
    async function check() {
        setBusy(true);
        try {
            const response = await fetch('/api/admin/shipping', { cache: 'no-store' });
            const data = await response.json() as { error?: string; message: string; connected: boolean; webhookConfigured: boolean; webhookRegistered: boolean };
            if (!response.ok) throw Error(data.error || 'Carrier check unavailable.');
            setMessage(data.message + (data.connected ? (data.webhookConfigured && data.webhookRegistered ? ' Automatic tracking updates are configured, but successful updates have not yet been verified.' : ' Automatic tracking updates need attention. Use Check carrier status on each labeled order until the webhook connection is verified.') : ''));
        } catch { setMessage('Could not verify the carrier connection. Please retry.'); }
        finally { setBusy(false); }
    }
    return <div><p>Labels and tracking use EasyPost with USPS / UPS. Pickup must be arranged separately after packing.</p><button className="text-button" disabled={busy} onClick={check}>{busy ? 'Checking carrier…' : 'Check carrier connection'}</button>{message && <p role="status">{message}</p>}</div>;
}
