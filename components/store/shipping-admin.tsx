'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { money } from '@/lib/catalog';
import styles from './shipping-help.module.css';
// Admin order controls for EasyPost: buy the label, open it for printing, and resend the tracking email.
export async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/admin/shipping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})) as any;
    if (!r.ok)
        throw new Error(d.error || 'Request failed.');
    return d;
}
// compact: the buy button only, for one-line table rows. The confirmation still names the saved service.
export function ShippingLabel({ order, onDone, compact = false }: { order: any; onDone: () => void; compact?: boolean }) {
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const s = order.data?.shipment;
    const previewUrl = typeof s?.labelUrl === 'string' && /^https:\/\//i.test(s.labelUrl) ? s.labelUrl : null;
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
        return <div className="shipping-label"><p><strong>{s.service}</strong> · {s.tracking}{s.status ? ' · ' + String(s.status).replaceAll('_', ' ') : ''}{Number.isFinite(s.costCents) ? ' · label ' + money(s.costCents) : ''}</p><p>{previewUrl && <><button type="button" className="text-button" aria-expanded={preview} onClick={() => { setPreview(v => !v); setImageFailed(false); }}>{preview ? 'Hide label' : 'Show label'}</button> · </>}<a className="text-button" href={s.labelUrl} target="_blank" rel="noopener">Print label</a>{s.trackingUrl && <> · <a className="text-button" href={s.trackingUrl} target="_blank" rel="noopener">Track</a></>} · <button className="text-button" disabled={busy} onClick={() => act({ refreshTracking: true })}>Check carrier status</button> · <button className="text-button" disabled={busy} onClick={() => act({ resend: true })}>Resend tracking email</button></p><p>{(s.sweptAt || s.checkedAt) ? 'Carrier last asked ' + new Date(s.sweptAt || s.checkedAt).toLocaleString() + '.' + (s.checkedAt ? ' Last change the carrier reported: ' + new Date(s.checkedAt).toLocaleString() + '.' : ' The carrier has reported no change yet.') : 'No carrier status refresh is recorded. Use Check carrier status for a fresh observation.'}</p>{preview && previewUrl && <div className={styles.label}><p><strong>Existing postage label</strong> · Previewing does not buy another label.</p>{imageFailed ? <p>This label format cannot be previewed here. Use Print label to open the original printable file.</p> : <img src={previewUrl} alt={'Shipping label for order ' + order.id.slice(0, 8)} referrerPolicy="no-referrer" onError={() => setImageFailed(true)}/>}<p>Use Print label for the original file and printer controls.</p></div>}</div>;
    if (order.status === 'labeling')
        return <p className="notice">A label purchase is in progress. Refresh in a moment.</p>;
    if (order.status !== 'paid')
        return null;
    const picked = order.data?.shippingOption;
    const carrierName = picked?.serviceKey && picked.carrier && picked.carrierService ? picked.carrier + ' ' + String(picked.carrierService).replaceAll('_', ' ') : '';
    const service = (order.data?.shippingService || 'Standard shipping') + (carrierName && carrierName !== order.data?.shippingService ? ' (' + carrierName + ')' : '');
    const buy = <button className="button button-gold" disabled={busy} onClick={() => act({}, `Buy the shipping label for this order? The customer paid for ${service}. A slower service is upgraded to your store minimum, set under Settings > Shipping. Your EasyPost account will be charged the current carrier rate, and the saved customer charge will not change.`)}>{busy ? 'Buying label...' : 'Buy shipping label'}</button>;
    if (compact) return buy;
    return <div><p><strong>Requested delivery:</strong> {service}. Label purchase must match the saved service. Handling fees are store charges, not postage.</p>{buy}</div>;
}
