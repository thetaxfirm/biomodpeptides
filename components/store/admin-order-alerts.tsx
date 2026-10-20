'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
// Who gets told about a new paid order and about the daily parcel digest. Editable here so adding a
// phone or a second owner never needs a deployment (owner, Oct 20 2026).
async function call(body?: Record<string, unknown>) {
    const r = await fetch('/api/admin/order-alerts', body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { headers: { 'Cache-Control': 'no-store' } });
    const d = await r.json().catch(() => ({})) as any;
    if (!r.ok) throw new Error(d.error || 'Request failed.');
    return d;
}
export function AdminOrderAlerts({ busy, onDraft }: { busy: boolean; onDraft?: () => void }) {
    const [value, setValue] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        call().then(d => { if (!live) return; setValue((d.recipients || []).join('\n')); setLoaded(true); })
            .catch(() => { if (live) { setError('The alert list could not load. Refresh administration to try again.'); setLoaded(true); } });
        return () => { live = false; };
    }, []);
    async function save() {
        setSaving(true);
        try {
            const d = await call({ recipients: value });
            setValue((d.recipients || []).join('\n'));
            toast.success(d.message || 'Saved.');
        }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Request failed.'); }
        finally { setSaving(false); }
    }
    return <section className="account-record">
        <h2>New-order alerts</h2>
        <p>One address per line, up to ten. Everyone here gets an email the moment an order is paid for, and the 9 a.m. parcel digest. Customers never see this list.</p>
        {error ? <p className="notice error" role="alert">{error}</p> : <>
            <label className="store-field">Send alerts to
                <textarea rows={5} value={value} disabled={!loaded || busy || saving} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                    placeholder={loaded ? 'you@example.com\nother-owner@example.com' : 'Loading…'}
                    onChange={e => { setValue(e.target.value); onDraft?.(); }}/>
            </label>
            <p className="notice">Leave it empty to fall back to the addresses set in Cloudflare. To get these on your phone as a push alert, add your normal email address here and set a Gmail filter for mail from the store, then turn on notifications for that label in the Gmail app. Carrier text gateways such as <code>@vtext.com</code> and <code>@txt.att.net</code> mostly no longer work, so do not rely on one for an order you have to ship.</p>
            <button type="button" className="button button-dark" disabled={!loaded || busy || saving} onClick={save}>{saving ? 'Saving…' : 'Save alert list'}</button>
        </>}
    </section>;
}
