'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { acceptAttribute, kindLabels, statusLabels, updateKinds, MAX_FILES, MAX_FILE_BYTES, type SiteUpdate, type UpdateKind } from '@/lib/site-updates';
import styles from './site-updates.module.css';

type Loaded = { updates: SiteUpdate[]; owner: boolean; products: { id: number; name: string }[] };
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const sizeLabel = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
async function call(body: unknown) {
    const r = await fetch('/api/site-updates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})) as Record<string, any>;
    if (!r.ok) throw new Error(d.error || 'That did not save. Refresh and try again.');
    return d;
}
const kindHelp: Record<UpdateKind, string> = {
    picture: 'Attach the new picture. Say whether it replaces the current one or is an extra view.',
    coa: 'Attach the lab report PDF. It is published only for the lot printed on the vial label.',
    wording: 'Say which page, what it says now, and what it should say.',
    other: 'Describe it. Prices, stock, policies and product claims go to the owner for a yes first.',
};

/**
 * Website updates (owner request, Nov 24 2026). The person in charge of pictures and lab reports
 * writes the change here and attaches the files. The change is then made, checked and published
 * from the owner's desk, and the result is written back on the request.
 */
export function SiteUpdates({ reloadToken = 0 }: { reloadToken?: number }) {
    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [kind, setKind] = useState<UpdateKind>('picture');
    const [files, setFiles] = useState<File[]>([]);
    const [formKey, setFormKey] = useState(0);
    const [replies, setReplies] = useState<Record<string, string>>({});
    const latest = useRef(0);
    async function load() {
        const turn = ++latest.current;
        try {
            const r = await fetch('/api/site-updates', { cache: 'no-store' });
            const d = await r.json().catch(() => ({})) as Loaded & { error?: string };
            if (turn !== latest.current) return;
            if (!r.ok) { setError(d.error || 'Website updates could not load.'); return; }
            setData(d); setError('');
        } catch { if (turn === latest.current) setError('Website updates could not load. Check your connection and refresh.'); }
    }
    useEffect(() => { void load(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps
    function pick(list: FileList | null) {
        const chosen = Array.from(list || []);
        const tooBig = chosen.find(f => f.size > MAX_FILE_BYTES);
        if (tooBig) { toast.error(tooBig.name + ' is larger than 16 MB. Send a smaller copy.'); return; }
        if (chosen.length > MAX_FILES) { toast.error('Attach up to ' + MAX_FILES + ' files. Send the rest in a second request.'); return; }
        setFiles(chosen);
    }
    async function send(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        try {
            setBusy('Sending…');
            const created = await call({ op: 'create', kind, productId: form.get('productId') || null, lot: form.get('lot') || '', message: form.get('message') || '' });
            for (const [index, file] of files.entries()) {
                setBusy('Uploading file ' + (index + 1) + ' of ' + files.length + '…');
                const r = await fetch('/api/site-updates/file?update=' + encodeURIComponent(created.id) + '&name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
                const d = await r.json().catch(() => ({})) as Record<string, any>;
                if (!r.ok) throw new Error((d.error || 'That file did not upload.') + ' Nothing was sent. Fix the file and press Send again.');
            }
            setBusy('Sending…');
            const done = await call({ op: 'submit', id: created.id });
            toast.success(done.message || 'Sent.');
            setFiles([]); setFormKey(k => k + 1);
            await load();
        } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'That did not send. Try again.'); }
        finally { setBusy(''); }
    }
    async function act(body: Record<string, unknown>, id: string) {
        if (busy) return;
        try {
            setBusy('Saving…');
            const done = await call({ ...body, id });
            toast.success(done.message || 'Saved.');
            setReplies(previous => ({ ...previous, [id]: '' }));
            await load();
        } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'That did not save. Try again.'); }
        finally { setBusy(''); }
    }
    if (error && !data) return <div className="notice error"><p role="alert">{error}</p><button type="button" className="button button-dark" onClick={() => void load()}>Try again</button></div>;
    if (!data) return <p role="status">Loading website updates…</p>;
    const needsProduct = kind === 'picture' || kind === 'coa';
    return <section className={styles.updates}>
        <h2>Website updates</h2>
        <p className={styles.lead}>Write the change you want on trybiomod.com and attach the files. It is made, checked and published for you, and the result is written back here. Pictures, lab reports and wording are done directly. Prices, stock, policies and product claims wait for the owner.</p>
        {error && <div className="notice error"><p role="alert">{error}</p></div>}
        <form key={formKey} className={'store-form ' + styles.form} onSubmit={send}>
            <h3>New request</h3>
            <div className="form-row">
                <label className="field"><span>What do you want changed?</span>
                    <select name="kind" aria-label="What do you want changed?" value={kind} onChange={e => setKind(e.target.value as UpdateKind)} disabled={Boolean(busy)}>{updateKinds.map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}</select>
                </label>
                <label className="field"><span>Product{needsProduct ? '' : ' (if it is about one)'}</span>
                    <select name="productId" aria-label="Product" required={needsProduct} defaultValue="" disabled={Boolean(busy)}><option value="">{needsProduct ? 'Choose a product' : 'Not about one product'}</option>{data.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </label>
                {kind === 'coa' && <label className="field"><span>Lot on the vial label</span><input name="lot" required maxLength={40} placeholder="301-10-0001" autoComplete="off" disabled={Boolean(busy)}/></label>}
            </div>
            <label className="field"><span>Describe the change</span>
                <textarea name="message" aria-label="Describe the change" required minLength={5} maxLength={4000} disabled={Boolean(busy)} placeholder={kind === 'coa' ? 'New Vanguard report for this lot. Replace the one on the product page.' : kind === 'picture' ? 'Use this as the main picture. The current one shows the old label.' : 'On the shipping page, change "2 to 4 days" to "2 to 3 days".'}/>
                <small className={styles.hint}>{kindHelp[kind]}</small>
            </label>
            <label className="field"><span>Files{needsProduct ? '' : ' (optional)'}</span>
                <input type="file" aria-label="Files" multiple accept={acceptAttribute} disabled={Boolean(busy)} onChange={e => pick(e.currentTarget.files)}/>
                <small className={styles.hint}>PDF or picture, up to 16 MB each, up to {MAX_FILES} files.</small>
                {files.length > 0 && <ul className={styles.picked}>{files.map(f => <li key={f.name + f.size}>{f.name} · {sizeLabel(f.size)}</li>)}</ul>}
            </label>
            <button className="button button-dark" disabled={Boolean(busy)}>{busy || 'Send request'}</button>
        </form>
        <h3 className={styles.sectionTitle}>{data.owner ? 'All requests' : 'Your requests'}</h3>
        {data.updates.length === 0 ? <p className={styles.empty}>No requests yet. The first one you send shows here with its progress.</p> : <ul className={styles.list}>{data.updates.map(u => {
            const open = !['done', 'cancelled'].includes(u.status);
            const reply = replies[u.id] || '';
            return <li key={u.id} className={styles.item} data-status={u.status}>
                <div className={styles.top}><strong>#{u.number} · {kindLabels[u.kind]}{u.productName ? ' · ' + u.productName : ''}{u.lot ? ' · lot ' + u.lot : ''}</strong><span className={styles.status}>{statusLabels[u.status]}</span></div>
                <p className={styles.meta}>{data.owner ? u.requester + ' · ' : ''}Sent {when(u.created)}{u.updated > u.created ? ' · updated ' + when(u.updated) : ''}{u.ownerOk ? ' · approved by the owner' : ''}</p>
                <p className={styles.message}>{u.message}</p>
                {u.files.length > 0 && <ul className={styles.files}>{u.files.map(f => <li key={f.id}><a href={'/api/site-updates/file?id=' + f.id} download={f.filename}>{f.filename}</a> · {sizeLabel(f.size)}</li>)}</ul>}
                {u.notes.length > 0 && <ul className={styles.thread}>{u.notes.map((n, i) => <li key={i} className={styles.note} data-from={n.authorType}><span>{n.author} · {when(n.created)}</span><p>{n.body}</p></li>)}</ul>}
                {u.status !== 'cancelled' && <div className={styles.reply}>
                    <label className="field"><span>{u.status === 'question' ? 'Your answer' : u.status === 'done' ? 'Something not right? Say what to fix' : 'Add a message'}</span>
                        <textarea aria-label={'Message on request ' + u.number} value={reply} maxLength={4000} disabled={Boolean(busy)} onChange={e => setReplies(previous => ({ ...previous, [u.id]: e.target.value }))}/>
                    </label>
                    <div className={styles.actions}>
                        <button type="button" className="button button-dark" disabled={Boolean(busy) || !reply.trim()} onClick={() => void act({ op: 'note', body: reply }, u.id)}>{u.status === 'question' ? 'Send answer' : 'Send message'}</button>
                        {data.owner && u.status === 'needs_owner' && <>
                            <button type="button" className="button button-dark" disabled={Boolean(busy)} onClick={() => void act({ op: 'approve', body: reply }, u.id)}>Approve and do it</button>
                            <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void act({ op: 'decline', body: reply }, u.id)}>Decline</button>
                        </>}
                        {open && u.status !== 'working' && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void act({ op: 'cancel' }, u.id)}>Cancel request</button>}
                    </div>
                </div>}
            </li>;
        })}</ul>}
    </section>;
}
