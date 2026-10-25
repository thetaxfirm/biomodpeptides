// Promo codes the owner adds from administration, stored in one settings row so a new code is live
// the moment it is saved instead of waiting on a deployment (owner, Oct 24 2026).
//
// The built-in table in ./promotions stays authoritative. A stored row can never reprice or shadow
// a built-in code: if the two ever name the same code, the built-in wins and the stored row is
// ignored everywhere, including here, in pricing and in the report.
//
// Deliberately depends on nothing but that table: this module is read on the checkout pricing path,
// and the caller always hands in the database it is already using.
import { activePromotions, type PromoRecord } from './promotions';

export const PROMO_CODES_KEY = 'promo_codes_v1';
export const MAX_STORED_PROMOS = 100;
/** A whole-order discount, so the ceiling is deliberate: a 100% code is a free-checkout hole on a
 * public storefront, and nothing on this store needs one. Comp an order by refunding it instead. */
export const MAX_PERCENT_OFF = 90;

export type StoredPromo = { code: string; percentOff: number; active: boolean; created: number; by: string };

export function cleanPromoCode(value: unknown): string {
    const code = String(value ?? '').trim().toUpperCase();
    return /^[A-Z0-9]{3,40}$/.test(code) ? code : '';
}
export function cleanPercentOff(value: unknown): number {
    const percent = Number(value);
    return Number.isInteger(percent) && percent >= 1 && percent <= MAX_PERCENT_OFF ? percent : 0;
}
export const builtInCodes = (): string[] => activePromotions().map(promo => promo.code);

/** Whatever is in the settings row is untrusted: legacy shapes, a hand-edited row and a corrupt
 * write all land here, and none of them may reach checkout pricing. Anything unrecognised is
 * dropped rather than repaired, because a half-understood discount is worse than a missing one. */
export function normalizeStoredPromos(raw: unknown): StoredPromo[] {
    if (!Array.isArray(raw)) return [];
    const reserved = new Set(builtInCodes());
    const seen = new Set<string>();
    const rows: StoredPromo[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const row = entry as Record<string, unknown>;
        const code = cleanPromoCode(row.code);
        const percentOff = cleanPercentOff(row.percentOff);
        if (!code || !percentOff || reserved.has(code) || seen.has(code)) continue;
        seen.add(code);
        const created = Number(row.created);
        rows.push({
            code, percentOff,
            active: row.active !== false,
            created: Number.isSafeInteger(created) && created > 0 ? created : 0,
            by: typeof row.by === 'string' ? row.by.slice(0, 120) : '',
        });
        if (rows.length >= MAX_STORED_PROMOS) break;
    }
    return rows;
}

function parseRow(value: string | null | undefined): unknown {
    if (typeof value !== 'string' || !value) return [];
    try { const parsed = JSON.parse(value); return parsed ?? []; }
    catch { return []; }
}

/** The raw row beside its usable rows. Administration needs the raw value to write back only if the
 * row has not changed underneath it; nothing else has any use for it. */
export async function readStoredPromos(db: D1Database): Promise<{ value: string | null; rows: StoredPromo[] }> {
    const row = await db.prepare('SELECT value FROM settings WHERE key=?').bind(PROMO_CODES_KEY).first<{ value: string }>();
    return { value: row?.value ?? null, rows: normalizeStoredPromos(parseRow(row?.value)) };
}

/** Every stored code, active or not. Administration reads this; pricing does not. */
export async function storedPromoList(db?: D1Database | null): Promise<StoredPromo[]> {
    if (!db) return [];
    try { return (await readStoredPromos(db)).rows; }
    catch { return []; }
}
/** What pricing may honour. An unreadable settings row leaves the built-in codes working and the
 * stored ones refused, which is the safe direction: a customer sees "not valid", never a wrong price. */
export async function storedPromotions(db?: D1Database | null, options: { throwOnReadError?: boolean } = {}): Promise<PromoRecord[]> {
    // Pricing can fail closed to built-ins. A saved-cookie resolver must distinguish an outage
    // from a successful empty list before deciding that a customer's code was removed.
    let rows: StoredPromo[];
    if (options.throwOnReadError) {
        if (!db) throw new Error('Promo settings are unavailable.');
        rows = (await readStoredPromos(db)).rows;
    } else rows = await storedPromoList(db);
    return rows.filter(promo => promo.active).map(({ code, percentOff }) => ({ code, percentOff }));
}
