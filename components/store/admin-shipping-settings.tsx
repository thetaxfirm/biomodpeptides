'use client';

import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/catalog';
import { normalizeShippingOptions, shippingServiceCatalog, type CatalogService, type ShippingOptionsConfig, type ShippingServiceSetting } from '@/lib/shipping-options';
import styles from './admin-shipping-settings.module.css';

type ShippingSettingsConfig = { shippingCents: number | null; freeShippingAt: number; shippingOptions?: unknown };
type LiveRate = { key: string; name: string; cents: number; days: number | null; tier: string | null };
type ServiceCheck = { key: string; label: string; status: 'ok' | 'missing' | 'wrong'; carrierCents: number | null; customerCents: number | null; message: string };
type Check = { ok: true; checkedAt: string; destination: string; package: string; rates: LiveRate[]; options: { label: string; note: string; cents: number; days: number | null }[]; services: ServiceCheck[]; freeStandardLabel: string | null } | { ok: false; error: string };
type Row = ShippingServiceSetting & { markup: string };
type Draft = { rows: Row[]; freeStandardEnabled: boolean; threshold: string; fallback: string };
const ENDPOINT = '/api/admin/shipping-services';
const carriers = ['USPS', 'UPS', 'FedEx'] as const;
const groups = { standard: 'Standard', expedited: 'Faster', overnight: 'Overnight' } as const;
const destinations = [['ny', 'New York, NY 10118'], ['la', 'Los Angeles, CA 90012'], ['chi', 'Chicago, IL 60602'], ['mia', 'Miami, FL 33133'], ['lv', 'Las Vegas, NV 89101']] as const;
const packages = [['v1', '1 vial'], ['v3', '3 vials'], ['v10', '10 vials'], ['b1', '1 bottle'], ['b3', '3 bottles']] as const;
const centsText = (cents: number) => String(cents / 100);
function parseDollars(value: string, label: string, maximum = 100000) {
    const number = value.trim() === '' ? NaN : Number(value);
    const cents = Math.round(number * 100);
    if (!Number.isFinite(number) || number < 0 || cents > maximum) throw new Error(`${label} must be an amount from $0 to ${money(maximum)}.`);
    return cents;
}
/** Starting rows. Before the first save, mirror what checkout does today: allowed carriers, enabled groups, per-group fee. */
function startingRows(options: ShippingOptionsConfig): Row[] {
    return shippingServiceCatalog.map(service => {
        const saved = options.services?.find(s => s.key === service.key);
        if (saved) return { ...saved, markup: centsText(saved.markupCents) };
        const legacyOn = !options.services && options.carriers.includes(service.carrier) && options[`${service.group}Enabled` as const];
        const legacyFee = options[`${service.group}HandlingCents` as const];
        return { key: service.key, enabled: Boolean(legacyOn), markupCents: options.services ? 0 : legacyFee, markup: centsText(options.services ? 0 : legacyFee), label: service.name, note: '' };
    });
}
function draftFrom(config: ShippingSettingsConfig): Draft {
    const options = normalizeShippingOptions(config.shippingOptions);
    return { rows: startingRows(options), freeStandardEnabled: options.freeStandardEnabled, threshold: centsText(config.freeShippingAt), fallback: config.shippingCents == null ? '' : centsText(config.shippingCents) };
}
/** Validated save payload. Throws a message the owner can act on. */
export function shippingServicesPayload(draft: Draft) {
    const services = draft.rows.map(row => {
        const name = shippingServiceCatalog.find(s => s.key === row.key)?.name || row.key;
        const label = row.label.trim();
        if (row.enabled && !label) throw new Error(`Give ${name} a name customers will see.`);
        return { key: row.key, enabled: row.enabled, markupCents: parseDollars(row.markup, `The extra charge for ${name}`), label: label || name, note: row.note.trim() };
    });
    return { services, freeStandardEnabled: draft.freeStandardEnabled, freeShippingAt: parseDollars(draft.threshold, 'Free shipping minimum', 1000000), shippingCents: draft.fallback.trim() === '' ? null : parseDollars(draft.fallback, 'Backup standard price') };
}
async function call(body?: unknown): Promise<any> {
    const response = await fetch(ENDPOINT, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Shipping settings could not be reached.');
    return data;
}

function Verdict({ check, savedMatches, enabledCount }: { check: Check | null; savedMatches: boolean | null; enabledCount: number }) {
    if (!check) return null;
    if (!check.ok) return <div className={styles.verdict} data-state="fail" role="status"><strong>Could not check live prices</strong><p>{check.error}</p></div>;
    const wrong = check.services.filter(s => s.status === 'wrong'), missing = check.services.filter(s => s.status === 'missing');
    const state = savedMatches === false || wrong.length || !check.options.length ? 'fail' : missing.length ? 'warn' : 'ok';
    const title = state === 'ok' ? `All ${check.options.length} shipping ${check.options.length === 1 ? 'option is' : 'options are'} working`
        : state === 'warn' ? `${check.options.length} working, ${missing.length} not offered for this sample`
        : savedMatches === false ? 'The save did not stick. Nothing changed for customers.'
        : !check.options.length ? (enabledCount ? 'Customers would see no shipping options' : 'Every service is turned off')
        : 'A price did not match your settings';
    return <div className={styles.verdict} data-state={state} role="status">
        <strong>{title}</strong>
        <p>Checked live with the carriers just now: {check.package} to {check.destination}{savedMatches ? ', saved settings read back and matched' : ''}. Nothing was bought.</p>
        {check.options.length > 0 && <ul className={styles.preview} aria-label="What a customer sees at checkout">{check.options.map(o => <li key={o.label}><span>{o.label}{o.note && <small>{o.note}</small>}</span><b>{money(o.cents)}</b></li>)}</ul>}
        {check.freeStandardLabel && <p>Orders over the free shipping minimum get <b>{check.freeStandardLabel.replace(/^Free · /, '')}</b> free.</p>}
        {[...wrong, ...missing].map(s => <p key={s.key} className={styles.problem}><b>{s.label}:</b> {s.message}</p>)}
    </div>;
}

export function AdminShippingSettings({ config, busy = false }: { config: ShippingSettingsConfig; busy?: boolean }) {
    const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
    const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(draftFrom(config)));
    const [perServiceSaved, setPerServiceSaved] = useState(() => Boolean(normalizeShippingOptions(config.shippingOptions).services));
    const [destination, setDestination] = useState('ny');
    const [sample, setSample] = useState('v3');
    const [check, setCheck] = useState<Check | null>(null);
    const [savedMatches, setSavedMatches] = useState<boolean | null>(null);
    const [working, setWorking] = useState<'' | 'check' | 'save'>('');
    const [error, setError] = useState('');
    const started = useRef(false);
    const verdictRef = useRef<HTMLDivElement>(null);
    const locked = busy || working !== '';
    const dirty = JSON.stringify(draft) !== savedDraft;
    const live = new Map((check?.ok ? check.rates : []).map(r => [r.key, r]));
    const enabledCount = draft.rows.filter(r => r.enabled).length;

    async function runCheck(nextDestination = destination, nextSample = sample) {
        setWorking('check'); setError(''); setSavedMatches(null);
        try { setCheck((await call({ action: 'check', destination: nextDestination, sample: nextSample })).check); }
        catch (e) { setError(e instanceof Error ? e.message : 'The check failed.'); }
        finally { setWorking(''); }
    }
    async function save() {
        let settings;
        try { settings = shippingServicesPayload(draft); }
        catch (e) { setError(e instanceof Error ? e.message : 'Check the shipping settings.'); return; }
        setWorking('save'); setError('');
        try {
            const result = await call({ action: 'save', settings, destination, sample });
            const next = draftFrom({ shippingCents: result.shippingCents, freeShippingAt: result.freeShippingAt, shippingOptions: result.settings });
            setDraft(next); setSavedDraft(JSON.stringify(next)); setPerServiceSaved(true);
            setSavedMatches(result.savedMatches === true); setCheck(result.check);
            setTimeout(() => verdictRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0);
        } catch (e) { setError(e instanceof Error ? e.message : 'Shipping could not be saved.'); }
        finally { setWorking(''); }
    }
    // Load live carrier prices once so every row shows what the customer would pay.
    useEffect(() => { if (!started.current) { started.current = true; void runCheck(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const update = (key: string, patch: Partial<Row>) => setDraft(d => ({ ...d, rows: d.rows.map(r => r.key === key ? { ...r, ...patch } : r) }));

    function serviceRow(service: CatalogService) {
        const row = draft.rows.find(r => r.key === service.key)!;
        const rate = live.get(service.key);
        const extra = Number(row.markup);
        const pays = rate && row.markup.trim() !== '' && Number.isFinite(extra) && extra >= 0 ? rate.cents + Math.round(extra * 100) : null;
        const id = 'ship-' + service.key.replace(':', '-');
        return <tr key={service.key} data-enabled={row.enabled}>
            <td className={styles.offer}><input id={id} type="checkbox" checked={row.enabled} disabled={locked} onChange={e => update(service.key, { enabled: e.target.checked })}/></td>
            <td className={styles.service}><label htmlFor={id}>{service.name}</label><small>{groups[service.group]} · {service.detail}</small></td>
            <td className={styles.num} data-label="Carrier price">{rate ? <>{money(rate.cents)}{rate.days ? <small>{rate.days} {rate.days === 1 ? 'day' : 'days'}</small> : null}</> : <span className={styles.muted}>{check?.ok ? 'Not offered' : '…'}</span>}</td>
            <td className={styles.extra} data-label="Your extra"><span className={styles.dollar}>$</span><input aria-label={`Extra charge for ${service.name}`} type="number" min="0" max="1000" step="0.01" inputMode="decimal" value={row.markup} disabled={locked} onChange={e => update(service.key, { markup: e.target.value })}/></td>
            <td className={styles.num} data-label="Customer pays"><b>{pays === null ? '—' : money(pays)}</b></td>
            <td className={styles.wording} data-label="Customer sees"><input aria-label={`Name customers see for ${service.name}`} maxLength={80} value={row.label} disabled={locked} placeholder={service.name} onChange={e => update(service.key, { label: e.target.value })}/><input aria-label={`Note customers see for ${service.name}`} maxLength={160} value={row.note} disabled={locked} placeholder="Optional note, e.g. Arrives in 1 to 2 days" onChange={e => update(service.key, { note: e.target.value })}/></td>
        </tr>;
    }
    const unsupported = check?.ok ? check.rates.filter(r => !shippingServiceCatalog.some(s => s.key === r.key)) : [];

    return <section className={styles.settings} aria-labelledby="shipping-settings-title">
        <div className={styles.head}>
            <h2 id="shipping-settings-title">Shipping</h2>
            <p>Every service EasyPost can quote for USPS, UPS and FedEx. Tick what customers may choose, set what you add on top of the carrier price, and write what they see. Saving checks it live right away.</p>
        </div>
        {!perServiceSaved && <p className={styles.notice}>Not set up yet. Right now checkout shows only the cheapest service in each speed with no extra charge. Choose your options below and save.</p>}

        <div className={styles.sampleBar}>
            <label>Price check to <select value={destination} disabled={locked} onChange={e => { setDestination(e.target.value); void runCheck(e.target.value, sample); }}>{destinations.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
            <label>Package <select value={sample} disabled={locked} onChange={e => { setSample(e.target.value); void runCheck(destination, e.target.value); }}>{packages.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
            <button type="button" className={styles.secondary} disabled={locked} onClick={() => void runCheck()}>{working === 'check' ? 'Checking…' : 'Check live prices'}</button>
        </div>

        <div ref={verdictRef} className={styles.anchor}><Verdict check={check} savedMatches={savedMatches} enabledCount={enabledCount}/></div>

        {carriers.map(carrier => <div key={carrier} className={styles.carrier}>
            <h3>{carrier}</h3>
            <table className={styles.table}>
                <thead><tr><th className={styles.offer}>Offer</th><th>Service</th><th className={styles.num}>Carrier charges you</th><th>Your extra</th><th className={styles.num}>Customer pays</th><th>Customer sees</th></tr></thead>
                <tbody>{shippingServiceCatalog.filter(s => s.carrier === carrier).map(serviceRow)}</tbody>
            </table>
        </div>)}
        {unsupported.length > 0 && <p className={styles.muted}>Carriers also quoted {unsupported.map(r => r.name).join(', ')}. These are not offered yet.</p>}

        <div className={styles.extras}>
            <div>
                <label className={styles.check}><input type="checkbox" checked={draft.freeStandardEnabled} disabled={locked} onChange={e => setDraft(d => ({ ...d, freeStandardEnabled: e.target.checked }))}/><span>Free shipping over a minimum</span></label>
                <label className={styles.field}><span>Minimum order, after discounts ($)</span><input type="number" min="0" max="10000" step="0.01" value={draft.threshold} disabled={locked || !draft.freeStandardEnabled} onChange={e => setDraft(d => ({ ...d, threshold: e.target.value }))}/></label>
                <p className={styles.muted}>The standard service that costs you the least becomes free. Faster services keep their price.</p>
            </div>
            <div>
                <label className={styles.field}><span>Backup standard price if carriers do not answer ($)</span><input type="number" min="0" max="1000" step="0.01" value={draft.fallback} placeholder="None" disabled={locked} onChange={e => setDraft(d => ({ ...d, fallback: e.target.value }))}/></label>
                <p className={styles.muted}>Leave empty to stop checkout instead of guessing a price.</p>
            </div>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
            <button type="button" className="button button-dark" disabled={locked || (!dirty && perServiceSaved)} onClick={() => void save()}>{working === 'save' ? 'Saving and checking…' : 'Save shipping and check it'}</button>
            <span className={styles.muted}>{dirty ? 'Unsaved changes. ' : savedMatches && check?.ok ? '' : perServiceSaved ? 'Saved. ' : ''}Orders already placed keep the shipping they paid for.</span>
            {savedMatches !== null && !dirty && <span className={styles.result} data-state={savedMatches && check?.ok && check.services.every(s => s.status === 'ok') && check.options.length ? 'ok' : 'fail'} role="status">{savedMatches && check?.ok && check.services.every(s => s.status === 'ok') && check.options.length ? 'Saved and checked live: everything works.' : 'Saved, but the live check found a problem. See the check above.'}</span>}
        </div>
    </section>;
}
