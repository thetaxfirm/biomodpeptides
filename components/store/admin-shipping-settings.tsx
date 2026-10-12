'use client';

import { useState } from 'react';
import { money } from '@/lib/catalog';
import { normalizeShippingOptions } from '@/lib/shipping-options';
import styles from './admin-shipping-settings.module.css';

const tiers = [
    { key: 'standard', title: 'Standard', description: 'Eligible ground and economy services.' },
    { key: 'expedited', title: 'Expedited', description: 'Eligible faster carrier services.' },
    { key: 'overnight', title: 'Overnight', description: 'Eligible overnight carrier services.' },
] as const;
const carriers = ['USPS', 'UPS', 'FedEx'] as const;
type ShippingSettingsConfig = { shippingCents: number | null; freeShippingAt: number; shippingOptions?: unknown };
type FormValues = Record<string, FormDataEntryValue>;
function dollars(value: FormDataEntryValue | undefined, label: string, maximum = 100000) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    const cents = Math.round(number * 100);
    if (!Number.isFinite(number) || number < 0 || cents > maximum) throw new Error(`${label} must be an amount from $0 to ${money(maximum)}.`);
    return cents;
}

// Only the current form version includes delivery options. Older callers retain
// their saved options rather than interpreting absent checkboxes as false.
export function shippingSettingsFromForm(data: FormValues) {
    const base = { shippingCents: data.shipping === '' ? null : dollars(data.shipping, 'Standard fallback'), freeShippingAt: dollars(data.threshold, 'Free standard threshold', 1000000) };
    if (data.shippingSettingsVersion !== '1') return base;
    const selectedCarriers = carriers.filter(carrier => data[`shippingCarrier${carrier}`] === 'on');
    if (!selectedCarriers.length) throw new Error('Select at least one shipping carrier before saving.');
    return { ...base, shippingOptions: {
        standardEnabled: data.standardEnabled === 'on', expeditedEnabled: data.expeditedEnabled === 'on', overnightEnabled: data.overnightEnabled === 'on', freeStandardEnabled: data.freeStandardEnabled === 'on',
        standardHandlingCents: dollars(data.standardHandling, 'Standard handling fee'), expeditedHandlingCents: dollars(data.expeditedHandling, 'Expedited handling fee'), overnightHandlingCents: dollars(data.overnightHandling, 'Overnight handling fee'), carriers: selectedCarriers,
    } };
}

export function AdminShippingSettings({ config, busy = false }: { config: ShippingSettingsConfig; busy?: boolean }) {
    const [options, setOptions] = useState(() => normalizeShippingOptions(config.shippingOptions));
    const [fees, setFees] = useState(() => ({ standard: String(options.standardHandlingCents / 100), expedited: String(options.expeditedHandlingCents / 100), overnight: String(options.overnightHandlingCents / 100) }));
    const enabledCount = [options.standardEnabled, options.expeditedEnabled, options.overnightEnabled].filter(Boolean).length;
    return <fieldset className={styles.settings} disabled={busy}>
        <legend>Shipping options</legend>
        <input type="hidden" name="shippingSettingsVersion" value="1"/>
        <p className={styles.intro}>Customers pay the live carrier quote plus your handling fee. Enabled options appear only when a connected carrier returns an eligible rate for the delivery address.</p>
        <div className={styles.tiers}>{tiers.map(tier => {
            const enabledKey = `${tier.key}Enabled` as const, value = Number(fees[tier.key]);
            return <section key={tier.key} className={styles.tier} data-enabled={options[enabledKey]} aria-labelledby={`shipping-tier-${tier.key}`}>
                <div className={styles.tierHeading}><h3 id={`shipping-tier-${tier.key}`}>{tier.title}</h3><label className={styles.toggle}><input type="checkbox" name={enabledKey} checked={options[enabledKey]} onChange={e => { if (!busy) setOptions(previous => ({ ...previous, [enabledKey]: e.target.checked })); }}/><span>Enable {tier.title.toLowerCase()}</span></label></div>
                <p>{tier.description}</p>
                <label className={styles.fee}><span>{tier.title} handling fee ($)</span><input name={`${tier.key}Handling`} type="number" min="0" max="1000" step="0.01" required value={fees[tier.key]} onChange={e => { if (!busy) setFees(previous => ({ ...previous, [tier.key]: e.target.value })); }}/></label>
                <output className={styles.formula} aria-live="polite">{fees[tier.key].trim() !== '' && Number.isFinite(value) && value >= 0 ? `Live carrier quote + ${money(Math.round(value * 100))} handling` : 'Enter a handling fee to see the pricing.'}</output>
                {!options[enabledKey] && <p className={styles.saved}>Disabled at checkout. The fee stays saved.</p>}
            </section>;
        })}</div>
        {!enabledCount && <p className={styles.warning} role="status">All delivery tiers are disabled. Customers will have no shipping options until you enable a tier.</p>}
        <p className={styles.timing}>Overnight refers to carrier transit time after dispatch. It does not change preorder dispatch dates or guarantee next-calendar-day, weekend or holiday delivery.</p>
        <section className={styles.section} aria-labelledby="shipping-carriers-title"><h3 id="shipping-carriers-title">Eligible carriers</h3><div className={styles.carriers}>{carriers.map((carrier, index) => <label className={styles.toggle} key={carrier}><input type="checkbox" name={`shippingCarrier${carrier}`} required={index === 0 && !options.carriers.length} checked={options.carriers.includes(carrier)} onChange={e => { if (!busy) setOptions(previous => ({ ...previous, carriers: e.target.checked ? [...previous.carriers, carrier] : previous.carriers.filter(item => item !== carrier) })); }}/><span>{carrier}</span></label>)}</div><p>Select at least one. Selecting a carrier allows its eligible rates; it does not connect or activate a carrier account in EasyPost.</p>{!options.carriers.length && <p className={styles.warning} role="alert">Choose at least one carrier before saving.</p>}</section>
        <section className={styles.section} aria-labelledby="shipping-free-title"><h3 id="shipping-free-title">Free standard shipping</h3><label className={styles.toggle}><input type="checkbox" name="freeStandardEnabled" checked={options.freeStandardEnabled} onChange={e => { if (!busy) setOptions(previous => ({ ...previous, freeStandardEnabled: e.target.checked })); }}/><span>Offer free standard shipping above a threshold</span></label><label className={styles.fee}><span>Free standard threshold ($)</span><input name="threshold" type="number" min="0" max="10000" step="0.01" required defaultValue={String(config.freeShippingAt / 100)}/></label><p>Uses the merchandise total after discounts. Expedited and overnight options keep their carrier rate plus handling fee.</p>{!options.standardEnabled && options.freeStandardEnabled && <p className={styles.warning}>Standard must also be enabled for the free standard offer to appear.</p>}</section>
        <section className={styles.section} aria-labelledby="shipping-fallback-title"><h3 id="shipping-fallback-title">Standard fallback</h3><label className={styles.fee}><span>Standard fallback price ($), optional</span><input name="shipping" type="number" min="0" max="1000" step="0.01" defaultValue={config.shippingCents == null ? '' : String(config.shippingCents / 100)} placeholder="No fallback"/></label><p>Used if a live Standard quote is unavailable. This is the total fallback charge; no handling fee is added. Leave blank to require a live rate for paid Standard shipping. Eligible free Standard can still apply. Expedited and overnight always require an eligible live carrier rate.</p></section>
        <p className={styles.note}>Save store settings below to apply changes to new quotes. Existing orders keep their saved shipping charges and service.</p>
    </fieldset>;
}
