'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import styles from './admin-promo-codes.module.css';
// Add and retire promo codes without a deployment (owner, Oct 24 2026). Built-in codes stay in
// source and are shown here read-only, so nothing on this screen can reprice an advertised code.
type Promo = { code: string; percentOff: number; active: boolean; created: number; by: string };
async function call(body?: Record<string, unknown>) {
    const r = await fetch('/api/admin/promo-codes', body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { headers: { 'Cache-Control': 'no-store' } });
    const d = await r.json().catch(() => ({})) as any;
    if (!r.ok) throw new Error(d.error || d.message || 'Request failed.');
    return d;
}
const day = (value: number) => value > 0 ? new Date(value).toISOString().slice(0, 10) : '';

export function AdminPromoCodes() {
    const [custom, setCustom] = useState<Promo[]>([]);
    const [builtIn, setBuiltIn] = useState<{ code: string; percentOff: number }[]>([]);
    const [maxPercent, setMaxPercent] = useState(90);
    const [loaded, setLoaded] = useState(false);
    // The endpoint requires store-settings access. Without it there is nothing to show and nothing
    // to say: the totals below are what this reader came for.
    const [denied, setDenied] = useState(false);
    const [adding, setAdding] = useState(false);
    const [code, setCode] = useState('');
    const [percent, setPercent] = useState('');
    const [working, setWorking] = useState('');

    useEffect(() => {
        let live = true;
        call().then(d => {
            if (!live) return;
            setCustom(d.custom || []);
            setBuiltIn(d.builtIn || []);
            if (Number.isInteger(d.maxPercentOff)) setMaxPercent(d.maxPercentOff);
            setLoaded(true);
        }).catch(() => { if (live) { setDenied(true); setLoaded(true); } });
        return () => { live = false; };
    }, []);

    async function action(label: string, body: Record<string, unknown>, after?: () => void) {
        setWorking(label);
        try {
            const d = await call(body);
            setCustom(d.custom || []);
            after?.();
            toast.success(d.message || 'Saved.');
        }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Request failed.'); }
        finally { setWorking(''); }
    }
    const locked = !loaded || Boolean(working);
    const typed = code.trim().toUpperCase();
    const clash = builtIn.some(p => p.code === typed);

    if (denied) return null;
    return <section className={'account-record ' + styles.panel} aria-labelledby="promo-codes-title">
        <h2 id="promo-codes-title">Promo codes</h2>
        <p>A code here takes a percentage off the whole order, after pack and sale prices. Saving one makes it live straight away — no deployment, no waiting.</p>
        {!adding && <button type="button" className="button button-dark" disabled={locked} onClick={() => setAdding(true)}>Add a promo code</button>}
            {adding && <div className={styles.row}>
                <label className={'store-field ' + styles.field}>Code
                    <input value={code} disabled={locked} spellCheck={false} autoComplete="off" autoCapitalize="characters" maxLength={40}
                        placeholder="SPRING15" onChange={e => setCode(e.target.value)}/>
                </label>
                <label className={'store-field ' + styles.field + ' ' + styles.percent}>Discount (%)
                    <input type="number" min={1} max={maxPercent} step={1} value={percent} disabled={locked}
                        placeholder="15" onChange={e => setPercent(e.target.value)}/>
                </label>
                <div className={styles.actions}>
                    <button type="button" className="button button-dark" disabled={locked || !typed || !percent.trim() || clash}
                        onClick={() => action('add', { code: typed, percentOff: Number(percent) }, () => { setCode(''); setPercent(''); setAdding(false); })}>{working === 'add' ? 'Saving…' : 'Save code'}</button>
                    <button type="button" className="text-button" disabled={locked} onClick={() => { setCode(''); setPercent(''); setAdding(false); }}>Cancel</button>
                </div>
            </div>}
            {adding && <p className={styles.sub}>{clash
                ? typed + ' is a built-in code. Pick a different one.'
                : 'Letters and digits, 3 to 40 characters. Whole percentages from 1 to ' + maxPercent + '. Customers can type it in any case.'}</p>}

            {custom.length > 0 && <ul className={styles.list}>{custom.map(promo => <li key={promo.code}>
                <strong className={styles.code + (promo.active ? '' : ' ' + styles.off)}>{promo.code}</strong>
                <span className={styles.meta}>{promo.percentOff}% off · {promo.active ? 'on' : 'off'}{promo.created ? ' · added ' + day(promo.created) : ''}{promo.by ? ' by ' + promo.by : ''}</span>
                <span className={styles.actions}>
                    <button type="button" className="text-button" disabled={locked}
                        onClick={() => action('toggle:' + promo.code, { code: promo.code, active: !promo.active })}>{promo.active ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" className="text-button" disabled={locked} onClick={() => {
                        const ask = typeof window === 'undefined' ? undefined : window.confirm;
                        if (ask && !ask('Delete ' + promo.code + '? Orders that already used it keep their discount, but the code stops working and leaves this list.')) return;
                        void action('delete:' + promo.code, { code: promo.code, remove: true });
                    }}>Delete</button>
                </span>
            </li>)}</ul>}
            {loaded && !custom.length && !adding && <p className="notice">No codes added here yet. The built-in codes below still work.</p>}

            <h3>Built-in codes</h3>
            <p className={styles.sub}>These live in the store’s source and cannot be edited here. Ask for a change if one needs a different discount.</p>
            <p className={styles.builtIn}>{builtIn.map(p => p.code + ' (' + p.percentOff + '%)').join(' · ') || 'Loading…'}</p>
    </section>;
}
