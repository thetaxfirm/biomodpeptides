'use client';

import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/catalog';
import { normalizeShippingOptions, shippingServiceCatalog, defaultMinimumServiceKey, signatureOptions, defaultSignatureConfirmation, type CatalogService, type ShippingOptionsConfig, type ShippingServiceSetting } from '@/lib/shipping-options';
import styles from './admin-shipping-settings.module.css';

type AutoLabel = { enabled: boolean; delayMs: number; dailyCapCents: number; maxLabelCents?: number };
/** What the last scheduled run did. Null means no run has reported yet, which is not the same as a failure. */
type AutoLabelHealth = { checkedAt: number; status: string; enabled: boolean; bought: number; failed: number; blocked: number; due: number; recovered: number; released: number; capReached: boolean } | null;
type ShippingSettingsConfig = { shippingCents: number | null; freeShippingAt: number; shippingOptions?: unknown; autoLabel?: AutoLabel; automaticSpend?: { cents: number; labels: number }; autoLabelHealth?: AutoLabelHealth };
type LiveRate = { key: string; name: string; cents: number; days: number | null; tier: string | null };
type ServiceCheck = { key: string; label: string; status: 'ok' | 'missing' | 'wrong'; carrierCents: number | null; customerCents: number | null; message: string };
type Check = { ok: true; checkedAt: string; destination: string; package: string; rates: LiveRate[]; options: { label: string; note: string; cents: number; days: number | null }[]; services: ServiceCheck[]; freeStandardLabel: string | null } | { ok: false; error: string };
type Row = ShippingServiceSetting & { markup: string };
type Draft = { rows: Row[]; freeStandardEnabled: boolean; threshold: string; fallback: string; minimumServiceKey: string; signatureConfirmation: string; autoEnabled?: boolean; autoDelay?: string; autoCap?: string; autoMax?: string };
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
    const auto = config.autoLabel;
    return { rows: startingRows(options), freeStandardEnabled: options.freeStandardEnabled, threshold: centsText(config.freeShippingAt), fallback: config.shippingCents == null ? '' : centsText(config.shippingCents), minimumServiceKey: options.minimumServiceKey || defaultMinimumServiceKey, signatureConfirmation: options.signatureConfirmation || defaultSignatureConfirmation,
        autoEnabled: auto ? auto.enabled : true, autoDelay: String(auto ? Math.round(auto.delayMs / 60000) : 20), autoCap: centsText(auto ? auto.dailyCapCents : 50000), autoMax: centsText(auto?.maxLabelCents ?? 5000) };
}
/** Validated save payload. Throws a message the owner can act on. */
export function shippingServicesPayload(draft: Draft) {
    const services = draft.rows.map(row => {
        const name = shippingServiceCatalog.find(s => s.key === row.key)?.name || row.key;
        const label = row.label.trim();
        if (row.enabled && !label) throw new Error(`Give ${name} a name customers will see.`);
        return { key: row.key, enabled: row.enabled, markupCents: parseDollars(row.markup, `The extra charge for ${name}`), label: label || name, note: row.note.trim() };
    });
    return { services, freeStandardEnabled: draft.freeStandardEnabled, freeShippingAt: parseDollars(draft.threshold, 'Free shipping minimum', 1000000), shippingCents: draft.fallback.trim() === '' ? null : parseDollars(draft.fallback, 'Backup standard price'), minimumServiceKey: draft.minimumServiceKey || defaultMinimumServiceKey, signatureConfirmation: draft.signatureConfirmation || defaultSignatureConfirmation,
        // Omitted rather than guessed when the caller did not collect them; the server then keeps what it has.
        ...(typeof draft.autoEnabled === 'boolean' ? { autoLabel: { enabled: draft.autoEnabled, delayMinutes: minutes(draft.autoDelay), dailyCapCents: parseDollars(draft.autoCap ?? '', 'The daily automatic postage limit', 10000000),
            // Omitted rather than guessed when the caller did not collect it; the server keeps the saved ceiling.
            ...(draft.autoMax === undefined || draft.autoMax === '' ? {} : { maxLabelCents: labelCeiling(draft.autoMax) }) } } : {}) };
}
/** The most one automatic label may cost. Bounded here and again on the server. */
function labelCeiling(value: string | undefined) {
    const cents = parseDollars(String(value ?? ''), 'The most to spend on one label', 100000);
    if (cents < 100) throw new Error('The most to spend on one label must be at least $1.00, or no label could ever be bought.');
    return cents;
}
/**
 * What the last scheduled run reported, in the owner's words. The job runs every five minutes, so a
 * report much older than that means the scheduler itself stopped — which is the failure nobody would
 * otherwise notice, because a job that never runs produces no errors at all.
 */
const STALE_REPORT_MS = 30 * 60000;
export function autoLabelReport(health: AutoLabelHealth, now = Date.now()): string {
    if (!health || typeof health.checkedAt !== 'number') return 'No automatic run has reported yet. Until one does, buy labels from the order.';
    const when = new Date(health.checkedAt).toLocaleString();
    if (now - health.checkedAt > STALE_REPORT_MS)
        return 'Last automatic run: ' + when + '. That is older than expected — the job runs every five minutes, so it may have stopped. Buy labels from the order until it reports again.';
    const reason: Record<string, string> = {
        settings_unreadable: 'Ran ' + when + ', but could not read your shipping settings, so it bought nothing. Nothing was charged.',
        disabled: 'Automatic buying is off. Ran ' + when + ' for recovery only.',
        coa_rule_on: 'Ran ' + when + ', but the COA-before-shipping rule is on, so it leaves every label to a person.',
        spend_unreadable: 'Ran ' + when + ', but could not total the last 24 hours of automatic postage, so it bought nothing.',
        cap_reached: 'Ran ' + when + '. The daily limit is reached, so orders are waiting in To ship for you.',
        queue_unreadable: 'Ran ' + when + ', but could not read the order queue, so it bought nothing.',
    };
    if (reason[health.status]) return reason[health.status];
    const parts = [health.bought + (health.bought === 1 ? ' label bought' : ' labels bought')];
    if (health.failed) parts.push(health.failed + (health.failed === 1 ? ' attempt failed' : ' attempts failed'));
    if (health.blocked) parts.push(health.blocked + (health.blocked === 1 ? ' order handed to you' : ' orders handed to you'));
    if (health.recovered) parts.push(health.recovered + ' already-paid label recovered');
    if (health.released) parts.push(health.released + ' stuck order released');
    return 'Last automatic run: ' + when + '. ' + parts.join(', ') + '.';
}
function minutes(value: string | undefined) {
    const n = Number(String(value ?? '').trim());
    if (!Number.isFinite(n) || n < 0 || n > 1440) throw new Error('The wait before buying a label must be between 0 and 1440 minutes.');
    return Math.round(n);
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
    const [health, setHealth] = useState<AutoLabelHealth>(config.autoLabelHealth ?? null);
    const [spend, setSpend] = useState(config.automaticSpend ?? null);
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
        try {
            const result = await call({ action: 'check', destination: nextDestination, sample: nextSample });
            setCheck(result.check);
            if (result.autoLabelHealth !== undefined) setHealth(result.autoLabelHealth);
            if (result.automaticSpend) setSpend(result.automaticSpend);
        }
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
            const next = draftFrom({ shippingCents: result.shippingCents, freeShippingAt: result.freeShippingAt, shippingOptions: result.settings, autoLabel: result.autoLabel, automaticSpend: result.automaticSpend });
            setDraft(next); setSavedDraft(JSON.stringify(next)); setPerServiceSaved(true);
            setSavedMatches(result.savedMatches === true); setCheck(result.check);
            if (result.autoLabelHealth !== undefined) setHealth(result.autoLabelHealth);
            if (result.automaticSpend) setSpend(result.automaticSpend);
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
                <label className={styles.field}><span>Never ship slower than</span>
                    <select value={draft.minimumServiceKey} disabled={locked} onChange={e => setDraft(d => ({ ...d, minimumServiceKey: e.target.value }))}>
                        <option value="none">No minimum — ship exactly what the customer paid for</option>
                        {shippingServiceCatalog.filter(service => service.group !== 'standard').map(service => <option key={service.key} value={service.key}>{service.name}</option>)}
                    </select>
                </label>
                <p className={styles.muted}>Upgrades a label when the paid service is slower. You pay the difference; the customer is never charged more. Faster paid services are left alone. Set to USPS Priority Mail unless you change it.</p>
                <label className={styles.field}><span>Delivery confirmation</span>
                    <select value={draft.signatureConfirmation} disabled={locked} onChange={e => setDraft(d => ({ ...d, signatureConfirmation: e.target.value }))}>
                        <option value="none">None — leave it on the doorstep</option>
                        {signatureOptions.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}
                    </select>
                </label>
                <p className={styles.muted}>Asked for when the label is bought, so checkout prices never change and you pay the fee. Proof of delivery is what defeats a &ldquo;never arrived&rdquo; chargeback; the trade is a missed delivery when nobody is home.</p>
            </div>
            <div>
                <label className={styles.check}><input type="checkbox" checked={draft.autoEnabled} disabled={locked} onChange={e => setDraft(d => ({ ...d, autoEnabled: e.target.checked }))}/><span>Buy labels automatically</span></label>
                <p className={styles.muted}>Paid orders get a label without anyone clicking. Orders on hold, internal tests and orders that already have a label are never bought. Turning this off stops buying immediately; labels already bought are unaffected.</p>
                <label className={styles.field}><span>Wait after payment (minutes)</span><input type="number" min="0" max="1440" step="1" value={draft.autoDelay} disabled={locked || !draft.autoEnabled} onChange={e => setDraft(d => ({ ...d, autoDelay: e.target.value }))}/></label>
                <p className={styles.muted}>Your window to spot a bad address or a problem order before postage is spent. The clock restarts whenever anyone touches the order.</p>
                <label className={styles.field}><span>Most to spend automatically per day ($)</span><input type="number" min="0" max="100000" step="1" value={draft.autoCap} disabled={locked || !draft.autoEnabled} onChange={e => setDraft(d => ({ ...d, autoCap: e.target.value }))}/></label>
                <p className={styles.muted}>Counts only labels bought automatically in the last 24 hours; your own purchases never count against it. At the limit, orders simply wait in To ship for you.{spend ? ' Spent automatically in the last 24 hours: ' + money(spend.cents) + ' across ' + spend.labels + (spend.labels === 1 ? ' label.' : ' labels.') : ''}</p>
                <label className={styles.field}><span>Most to spend on one label ($)</span><input type="number" min="1" max="1000" step="1" value={draft.autoMax} disabled={locked || !draft.autoEnabled} onChange={e => setDraft(d => ({ ...d, autoMax: e.target.value }))}/></label>
                <p className={styles.muted}>A single label above this is never bought automatically; the order waits in To ship so you can look at it. This is what catches a mistyped address that quotes a freight rate.</p>
                <p className={styles.muted} aria-live="polite">{autoLabelReport(health)}</p>
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
