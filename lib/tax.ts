// Fixed-rate sales tax. Enabled with FIXED_TAX_RATE (percent, up to 3 decimals, e.g. 8.375).
// Optional FIXED_TAX_STATE (two-letter code) limits the tax to orders shipped to that state;
// leave it unset (or set ALL) to charge the rate on every order.
// Tax applies to merchandise after discounts. Separately stated shipping is not taxed.
type Environment = Record<string, string | undefined>;
export type FixedTax = { state: string | null; rateThousandths: number };
export function fixedTaxConfig(env: Environment): FixedTax | null {
    const state = (env.FIXED_TAX_STATE || '').trim().toUpperCase();
    const rate = (env.FIXED_TAX_RATE || '').trim();
    const match = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(rate);
    if ((state && state !== 'ALL' && !/^[A-Z]{2}$/.test(state)) || !match)
        return null;
    // Percent to thousandths of a percent: 8.375 -> 8375.
    const rateThousandths = Number(match[1]) * 1000 + Number((match[2] || '0').padEnd(3, '0'));
    if (rateThousandths <= 0 || rateThousandths >= 30000)
        return null;
    return { state: state && state !== 'ALL' ? state : null, rateThousandths };
}
/** Tax in cents for a merchandise total in cents. Rounds half up to the nearest cent. */
export function fixedTaxCents(config: FixedTax, destinationState: string, merchandiseCents: number): number {
    if (!Number.isSafeInteger(merchandiseCents) || merchandiseCents < 0)
        throw new Error('Tax could not be verified.');
    if (config.state && destinationState.toUpperCase() !== config.state)
        return 0;
    // cents * (thousandths / 100000), rounded half up with integer math.
    return Math.floor((merchandiseCents * config.rateThousandths + 50000) / 100000);
}
