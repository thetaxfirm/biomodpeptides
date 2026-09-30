'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { money } from '@/lib/catalog';
// Admin order controls for EasyPost: buy the label, open it for printing, and resend the tracking email.
async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/admin/shipping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})) as any;
    if (!r.ok)
        throw new Error(d.error || 'Request failed.');
    return d;
}
export function ShippingLabel({ order, onDone }: { order: any; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    const s = order.data?.shipment;
    async function act(body: Record<string, unknown>, confirmText?: string) {
        if (confirmText && !window.confirm(confirmText))
            return;
        setBusy(true);
        try {
            const d = await post({ id: order.id, ...body });
            toast.success(d.message);
            if (d.labelUrl)
                window.open(d.labelUrl, '_blank', 'noopener');
            onDone();
        }
        catch (e) {
            toast.error(e instanceof Error ? e.message : 'Request failed.');
        }
        finally {
            setBusy(false);
        }
    }
    if (s?.tracking)
        return <div className="shipping-label"><p><strong>{s.service}</strong> · {s.tracking}{s.status ? ' · ' + String(s.status).replaceAll('_', ' ') : ''}{Number.isFinite(s.costCents) ? ' · label ' + money(s.costCents) : ''}</p><p><a className="text-button" href={s.labelUrl} target="_blank" rel="noopener">Print label</a>{s.trackingUrl && <> · <a className="text-button" href={s.trackingUrl} target="_blank" rel="noopener">Track</a></>} · <button className="text-button" disabled={busy} onClick={() => act({ resend: true })}>Resend tracking email</button></p></div>;
    if (order.status === 'labeling')
        return <p className="notice">A label purchase is in progress. Refresh in a moment.</p>;
    if (order.status !== 'paid')
        return null;
    return <button className="button button-gold" disabled={busy} onClick={() => act({}, 'Buy the cheapest USPS/UPS label for this order? Your EasyPost account will be charged.')}>{busy ? 'Buying label...' : 'Buy shipping label'}</button>;
}
