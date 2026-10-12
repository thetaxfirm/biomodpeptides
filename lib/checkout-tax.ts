import { fixedTaxConfig, fixedTaxCents } from './tax';
export async function checkoutTax(env: Record<string,string|undefined>, address: {state:string;zip:string;city:string;line1:string}, amount:number, shipping:number):Promise<number> {
    // TaxJar is used when connected. Otherwise the configured fixed rate applies (lib/tax.ts).
    // With neither configured, checkout stays closed: missing tax setup never becomes zero tax.
    if (!env.TAXJAR_API_TOKEN) {
        const fixed = fixedTaxConfig(env);
        if (!fixed)
            throw new Error('Checkout is not accepting orders yet. Tax and delivery setup is pending.');
        const tax = fixedTaxCents(fixed, address.state, amount);
        return tax;
    }
    if (!env.STORE_ORIGIN_ZIP || !env.STORE_ORIGIN_STATE)
        throw new Error('Checkout is not accepting orders yet. Tax and delivery setup is pending.');
    const r = await fetch('https://api.taxjar.com/v2/taxes', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + env.TAXJAR_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ from_country: 'US', from_zip: env.STORE_ORIGIN_ZIP, from_state: env.STORE_ORIGIN_STATE, to_country: 'US', to_zip: address.zip, to_state: address.state, to_city: address.city, to_street: address.line1, amount: amount / 100, shipping: shipping / 100 }) });
    if (!r.ok)
        throw new Error('Tax could not be calculated. Please try again later.');
    const d = await r.json() as {
        tax?: {
            amount_to_collect?: number;
        };
    };
    const t = d.tax?.amount_to_collect;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0)
        throw new Error('Tax could not be verified.');
    const tax = Math.round(t * 100);
    return tax;
}
