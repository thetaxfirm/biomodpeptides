/**
 * Restaurant partners: twenty fixed slots the owner fills in by typing a name (owner, Nov 13 2026).
 *
 * Deliberately its own program, with its own slots, its own naming and its own switches, rather
 * than more rows in the general promo code list. The owner asked for it kept apart from everything
 * else, and a restaurant deal is a different thing from a one-off discount code.
 *
 * What it is NOT is a second pricing path. A slot that is switched on writes its code into the
 * ordinary stored-promo row, so checkout pricing, the /r/ links, affiliate approval and the promo
 * report all keep reading exactly what they read today. Teaching four more call sites about a new
 * kind of discount would put the checkout price on a code path nobody has exercised; this way the
 * only new logic is how a name becomes a code, and that is all testable on its own.
 */
import { cleanPercentOff, cleanPromoCode, builtInCodes, MAX_PERCENT_OFF } from './promo-codes';

export const RESTAURANT_PARTNERS_KEY = 'restaurant_partners_v1';
export const PARTNER_SLOTS = 20;
export { MAX_PERCENT_OFF };

export type PartnerSlot = {
    slot: number;          // 1..PARTNER_SLOTS, fixed: a slot is a place on the page, not a record id
    name: string;          // what the owner typed; '' for an empty slot
    slug: string;          // the vanity link, derived from the name unless overridden
    code: string;          // the discount code, derived from the name unless overridden
    percentOff: number;    // 0 until the owner sets one; a slot cannot go live without it
    active: boolean;
    // Codes this slot has used before. A rename must take the old code down with it, and the
    // programme can only do that if it remembers what it issued: otherwise a renamed restaurant
    // leaves a live discount behind that credits nobody.
    previous: string[];
    updated: number;
    by: string;
};

/** A restaurant name as it can appear in a URL: "Mario's Pizza" -> "marios-pizza". */
export function slugFromName(value: unknown, max = 40): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/['’]/g, '')            // an apostrophe closes up rather than splitting the word
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max)
        .replace(/-+$/g, '');
}

/**
 * The same name as a discount code: "Mario's Pizza" -> "MARIOSPIZZA". Codes allow only letters and
 * digits, so there is nothing to separate the words with. Three characters is the floor the store's
 * own code rule sets, and a name shorter than that gets its slot number rather than being refused:
 * the owner is typing a real restaurant's name, and the machine should cope with it.
 */
export function codeFromName(value: unknown, slot: number, max = 40): string {
    const letters = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
    if (letters.length >= 3) return letters;
    return letters ? (letters + 'EAT' + slot).slice(0, max) : '';
}

/** Keeps two restaurants with the same first word apart, without silently repointing either. */
function unique(wanted: string, taken: Set<string>, join: string): string {
    if (!wanted || !taken.has(wanted)) return wanted;
    for (let n = 2; n < 100; n++) {
        const candidate = wanted + join + n;
        if (!taken.has(candidate)) return candidate;
    }
    return '';
}

export const emptySlot = (slot: number): PartnerSlot =>
    ({ slot, name: '', slug: '', code: '', percentOff: 0, active: false, previous: [], updated: 0, by: '' });

export const MAX_PREVIOUS_CODES = 10;
/** The codes a slot has issued before, cleaned and without the one it is using now. */
export function previousCodes(raw: unknown, current: string): string[] {
    const seen = new Set<string>();
    for (const entry of Array.isArray(raw) ? raw : []) {
        const code = cleanPromoCode(entry);
        if (code && code !== current) seen.add(code);
        if (seen.size >= MAX_PREVIOUS_CODES) break;
    }
    return [...seen];
}

/** A slot may only be switched on once it names a restaurant, a link, a code and a discount. */
export const slotReady = (row: PartnerSlot): boolean =>
    Boolean(row.name && row.slug && row.code && row.percentOff > 0);

/**
 * Whatever is in the settings row is untrusted: a legacy shape, a hand-edited row or a corrupt
 * write all land here. Anything unusable becomes an empty slot rather than being repaired, and the
 * result is always exactly PARTNER_SLOTS rows in slot order, so the screen never has to guess.
 */
export function normalizePartners(raw: unknown): PartnerSlot[] {
    const rows = Array.isArray(raw) ? raw : [];
    const reserved = new Set(builtInCodes());
    const slugs = new Set<string>(), codes = new Set<string>();
    const out: PartnerSlot[] = [];
    for (let slot = 1; slot <= PARTNER_SLOTS; slot++) {
        const found = rows.find(entry => entry && typeof entry === 'object' && Number((entry as Record<string, unknown>).slot) === slot) as Record<string, unknown> | undefined;
        if (!found) { out.push(emptySlot(slot)); continue; }
        const name = String(found.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        // An emptied slot still carries the codes it issued, so clearing a restaurant retires its
        // discount instead of abandoning it live with nobody to credit.
        if (!name) { out.push({ ...emptySlot(slot), previous: previousCodes(found.previous, '') }); continue; }
        const slug = unique(slugFromName(found.slug || name), slugs, '-');
        // A code colliding with a built-in is dropped, never quietly renamed: the owner would go on
        // handing out a code that prices as the store's own.
        const wanted = cleanPromoCode(found.code) || codeFromName(name, slot);
        const code = reserved.has(wanted) ? '' : unique(wanted, codes, '');
        if (slug) slugs.add(slug);
        if (code) codes.add(code);
        const percentOff = cleanPercentOff(found.percentOff);
        const updated = Number(found.updated);
        const row: PartnerSlot = {
            slot, name, slug, code, percentOff,
            active: false,
            previous: previousCodes(found.previous, code),
            updated: Number.isSafeInteger(updated) && updated > 0 ? updated : 0,
            by: typeof found.by === 'string' ? found.by.slice(0, 120) : '',
        };
        // Switched on is only honoured for a slot that is actually complete, so a partial row can
        // never price an order.
        row.active = found.active === true && slotReady(row);
        out.push(row);
    }
    return out;
}

/** The codes a switched-on slot expects the store to honour, for writing through to pricing. */
export const livePartnerCodes = (rows: PartnerSlot[]): { code: string; percentOff: number }[] =>
    rows.filter(row => row.active && slotReady(row)).map(({ code, percentOff }) => ({ code, percentOff }));

/** slug -> code, for the /r/ links. Only a switched-on slot resolves. */
export function partnerCodeForSlug(rows: PartnerSlot[], slug: unknown): string {
    const wanted = String(slug ?? '').trim().toLowerCase();
    if (!wanted) return '';
    const row = rows.find(entry => entry.slug === wanted && entry.active && slotReady(entry));
    return row ? row.code : '';
}

export function parsePartners(value: string | null | undefined): PartnerSlot[] {
    if (typeof value !== 'string' || !value) return normalizePartners([]);
    try { return normalizePartners(JSON.parse(value)); }
    catch { return normalizePartners([]); }
}

export async function readPartners(db: D1Database): Promise<{ value: string | null; rows: PartnerSlot[] }> {
    const row = await db.prepare('SELECT value FROM settings WHERE key=?').bind(RESTAURANT_PARTNERS_KEY).first<{ value: string }>();
    return { value: row?.value ?? null, rows: parsePartners(row?.value) };
}

/** Never throws: a restaurant programme that cannot be read must not stop a customer checking out. */
export async function partnerSlots(db?: D1Database | null): Promise<PartnerSlot[]> {
    if (!db) return normalizePartners([]);
    try { return (await readPartners(db)).rows; }
    catch { return normalizePartners([]); }
}

/**
 * Makes the stored promo row agree with the slots, in one compare-and-set.
 *
 * One write for all twenty, not twenty writes: a per-slot loop that failed halfway would leave some
 * restaurants live and others not, with no record of which. Codes the restaurant programme does not
 * own are copied through untouched, so a code added on the Promo codes tab is never disturbed.
 */
export async function syncPartnerCodes(db: D1Database, rows: PartnerSlot[], by: string, now = Date.now()): Promise<{ live: string[]; retired: string[] }> {
    const { readStoredPromos, PROMO_CODES_KEY: KEY } = await import('./promo-codes');
    const before = await readStoredPromos(db);
    const live = new Map(livePartnerCodes(rows).map(entry => [entry.code, entry.percentOff]));
    // Every code the programme has ever issued, current and retired, so switching a slot off or
    // renaming a restaurant takes the old code down with it.
    const owned = new Set(rows.flatMap(row => [row.code, ...row.previous]).filter(Boolean));
    const kept = before.rows.filter(promo => !owned.has(promo.code));
    const retired: string[] = [];
    for (const promo of before.rows) {
        if (!owned.has(promo.code) || live.has(promo.code)) continue;
        // Kept, switched off, never deleted: the code may already be printed on a table card, and a
        // customer typing it should be told it is not valid rather than quietly charged full price
        // against a code the store has forgotten.
        kept.push({ ...promo, active: false });
        if (promo.active) retired.push(promo.code);
    }
    const next = [...kept];
    for (const [code, percentOff] of live) {
        const existing = before.rows.find(promo => promo.code === code);
        const entry = { code, percentOff, active: true, created: existing?.created || now, by: by.slice(0, 120) };
        const at = next.findIndex(promo => promo.code === code);
        if (at >= 0) next[at] = entry; else next.push(entry);
    }
    const value = JSON.stringify(next);
    if (before.value === value) return { live: [...live.keys()], retired };
    const written = before.value !== null
        ? await db.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').bind(value, KEY, before.value).run()
        : await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(KEY, value).run();
    if (!written.meta.changes) throw new Error('Promo codes changed while this page was open. Reload and try again.');
    return { live: [...live.keys()], retired };
}
