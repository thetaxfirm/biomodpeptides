// Server-owned promotions. Never accept percentages or savings from a browser.
export const PROMO_COOKIE = 'bm_promo';
const promotions: Readonly<Record<string, number>> = Object.freeze({ BIOMOD10: 10, BIOMOD15: 15, BIOMOD20: 20 });
export function promotion(value?: unknown): { code: string; percentOff: number } | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > 40) throw new Error('Enter a valid promo code.');
    const code = value.trim().toUpperCase();
    if (!code) return null;
    if (!Object.hasOwn(promotions, code)) throw new Error('That promo code is not valid. Check the code and try again.');
    return { code, percentOff: promotions[code] };
}
/** One code, applied after existing pack/sale prices. Cumulative allocation keeps
 * line totals nonnegative and reconciles every cent, including zero-price lines. */
export function applyPromotion<T extends { lineTotal: number }>(items: T[], value?: unknown) {
    const selected = promotion(value);
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
