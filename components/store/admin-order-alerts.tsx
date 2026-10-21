'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import styles from './admin-order-alerts.module.css';
// Who gets told about a new paid order and about the daily parcel digest. Editable here so adding a
// phone or a second owner never needs a deployment (owner, Oct 20 2026).
async function call(body?: Record<string, unknown>) {
    const r = await fetch('/api/admin/order-alerts', body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { headers: { 'Cache-Control': 'no-store' } });
    const d = await r.json().catch(() => ({})) as any;
    // message is the fallback so a server that explains itself there is never reduced to 'Request failed.'
    if (!r.ok) throw new Error(d.error || d.message || 'Request failed.');
    return d;
}
type Found = { id: string; title: string; kind: string };
export function AdminOrderAlerts({ busy, onDraft }: { busy: boolean; onDraft?: () => void }) {
    const [value, setValue] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // Telegram: a bot token (write-only, never read back) and the chats to post into.
    const [configured, setConfigured] = useState(false);
    const [token, setToken] = useState('');
    const [chats, setChats] = useState('');
    const [found, setFound] = useState<Found[] | null>(null);
    const [chatBusy, setChatBusy] = useState('');
    useEffect(() => {
        let live = true;
        call().then(d => {
            if (!live) return;
            setValue((d.recipients || []).join('\n'));
            setConfigured(Boolean(d.telegram?.configured));
            setChats((d.telegram?.chats || []).join(', '));
            setLoaded(true);
        }).catch(() => { if (live) { setError('The alert list could not load. Refresh administration to try again.'); setLoaded(true); } });
        return () => { live = false; };
    }, []);
    async function chatAction(label: string, body: Record<string, unknown>) {
        setChatBusy(label);
        try {
            const d = await call(body);
            if (Array.isArray(d.chats)) setFound(d.chats as Found[]);
            if (d.telegram) { setConfigured(Boolean(d.telegram.configured)); setChats((d.telegram.chats || []).join(', ')); setToken(''); }
            toast.success(d.message || 'Done.');
        }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Request failed.'); }
        finally { setChatBusy(''); }
    }
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

            <h3>Telegram group (free, instant)</h3>
            <p>Posts every new order into a group chat, so everyone gets a push notification at once. Nothing is charged and no carrier is involved. The message carries the order number, the customer name and town, the item count and the total — never what was ordered, because it shows on a lock screen.</p>
            <ol className={styles.steps}>
                <li>In Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, and follow it. It replies with a token.</li>
                <li>Paste that token below and save.</li>
                <li>Make a group and add your bot to it. Then send <code>/start@yourbotname</code> in that group — a bot cannot see ordinary messages in a group, only commands aimed at it.</li>
                <li>Press <strong>Find my chats</strong>, pick the group, then save and send a test.</li>
            </ol>
            <label className="store-field">Bot token
                <input type="password" value={token} disabled={!loaded || busy || Boolean(chatBusy)} autoComplete="off" spellCheck={false}
                    placeholder={configured ? 'A token is saved. Type a new one to replace it.' : '1234567890:AA…'}
                    onChange={e => { setToken(e.target.value); onDraft?.(); }}/>
            </label>
            <p className={styles.sub}>{configured ? 'A bot token is saved. It is never shown again, and leaving this box empty keeps it as it is — type a new one only to replace it.' : 'No bot token saved yet.'}</p>
            <label className="store-field">Chat IDs
                <input value={chats} disabled={!loaded || busy || Boolean(chatBusy)} spellCheck={false} autoComplete="off"
                    placeholder="-1001234567890" onChange={e => { setChats(e.target.value); onDraft?.(); }}/>
            </label>
            {found && (found.length
                ? <ul className={styles.found}>{found.map(c => <li key={c.id}>
                    <button type="button" className="text-button" disabled={Boolean(chatBusy)} onClick={() => { setChats(c.id); onDraft?.(); }}>Use this</button>
                    {' '}<strong>{c.title}</strong> <span className={styles.sub}>{c.kind} · {c.id}</span>
                </li>)}</ul>
                : <p className="notice">No chats found yet. Add the bot to the group, then send <code>/start@yourbotname</code> there and look again.</p>)}
            <div className={styles.row}>
                <button type="button" className="button button-dark" disabled={!loaded || busy || Boolean(chatBusy)} onClick={() => chatAction('save', { ...(token.trim() ? { botToken: token } : {}), chatIds: chats })}>{chatBusy === 'save' ? 'Saving…' : 'Save Telegram settings'}</button>
                <button type="button" className="text-button" disabled={!loaded || busy || Boolean(chatBusy)} onClick={() => chatAction('find', { findChats: true, botToken: token })}>{chatBusy === 'find' ? 'Looking…' : 'Find my chats'}</button>
                <button type="button" className="text-button" disabled={!loaded || busy || Boolean(chatBusy) || !configured} onClick={() => chatAction('test', { test: true })}>{chatBusy === 'test' ? 'Sending…' : 'Send a test message'}</button>
                {configured && <button type="button" className="text-button" disabled={!loaded || busy || Boolean(chatBusy)} onClick={() => { const ask = typeof window === 'undefined' ? undefined : window.confirm; if (ask && !ask('Remove the saved bot token? Order alerts stop reaching Telegram until you add one again.')) return; chatAction('clear', { clearToken: true }); }}>{chatBusy === 'clear' ? 'Removing…' : 'Remove saved token'}</button>}
            </div>
        </>}
    </section>;
}
