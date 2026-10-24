// Server-owned promotions. Never accept percentages or savings from a browser.
export const PROMO_COOKIE = 'bm_promo';
const promotions: Readonly<Record<string, number>> = Object.freeze({ BM10: 10, BIOMOD15: 15, BMOD20: 20, ANNA20: 20, KIMC15: 15,
    // Partner code (owner, Oct 19 2026). Customers may type it in any case; promotion() upper-cases.
    JENM20: 20,
    // Come-back codes for win-back and service emails (owner, Oct 13 2026). Not advertised on the site.
    COMEBACK10: 10, COMEBACK15: 15, COMEBACK20: 20, COMEBACK25: 25, COMEBACK30: 30 });
export type PromoRecord = { code: string; percentOff: number };
/**
 * The table above plus any codes the owner added in administration, which arrive as `extra` from
 * ./promo-codes. Callers that pass nothing see exactly the built-in table, so every existing call
 * site keeps its old behaviour.
 *
 * Built-ins win every collision. A stored row naming a built-in code is dropped rather than applied,
 * so no edit in administration can quietly reprice a code that is already printed on a card or sitting
 * in a customer's cookie. Nothing here reads a percentage from a browser.
 */
function table(extra: readonly PromoRecord[]): Record<string, number> {
    const added: Record<string, number> = {};
    for (const entry of extra || []) {
        const code = String(entry?.code ?? '').trim().toUpperCase();
        const percentOff = Number(entry?.percentOff);
        if (!/^[A-Z0-9]{1,40}$/.test(code) || Object.hasOwn(promotions, code)) continue;
        if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) continue;
        added[code] = percentOff;
    }
    return { ...promotions, ...added };
}
export function activePromotions(extra: readonly PromoRecord[] = []): PromoRecord[] {
    return Object.entries(table(extra)).map(([code, percentOff]) => ({ code, percentOff }));
}
export function promotion(value?: unknown, extra: readonly PromoRecord[] = []): PromoRecord | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > 40) throw new Error('Enter a valid promo code.');
    const code = value.trim().toUpperCase();
    if (!code) return null;
    const known = table(extra);
    if (!Object.hasOwn(known, code)) throw new Error('That promo code is not valid. Check the code and try again.');
    return { code, percentOff: known[code] };
}
/** One code, applied after existing pack/sale prices. Cumulative allocation keeps
 * line totals nonnegative and reconciles every cent, including zero-price lines. */
export function applyPromotion<T extends { lineTotal: number }>(items: T[], value?: unknown, extra: readonly PromoRecord[] = []) {
    const selected = promotion(value, extra);
    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const savings = selected ? Math.round(total * selected.percentOff / 100) : 0;
    let running = 0, allocated = 0;
    const discounted = items.map(item => {
        running += item.lineTotal;
        const cumulative = total > 0 ? Number(BigInt(running) * BigInt(savings) / BigInt(total)) : 0;
        const linePromoDiscount = cumulative - allocated;
        allocated = cumulative;
        return { ...item, lineTotal: item.lineTotal - linePromoDiscount, linePromoDiscount };
    });
    return { items: discounted, promo: selected ? { ...selected, savings } : null, promoDiscount: savings };
}
