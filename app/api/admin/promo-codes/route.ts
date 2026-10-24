import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { runtime } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
import { activePromotions } from '@/lib/promotions';
import { builtInCodes, cleanPercentOff, cleanPromoCode, readStoredPromos, MAX_PERCENT_OFF, MAX_STORED_PROMOS, PROMO_CODES_KEY, type StoredPromo } from '@/lib/promo-codes';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Promo codes the owner adds without a deployment. Built-in codes are listed read-only: they live in
 * source, and editing them here would let administration reprice a code that is already on a card.
 */
export async function GET() {
    try {
        await requireStaff('store:write');
        const env = runtime();
        return j({ builtIn: activePromotions(), custom: (await readStoredPromos(env.DB)).rows, maxPercentOff: MAX_PERCENT_OFF, limit: MAX_STORED_PROMOS });
    }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
}

export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin)
        return j({ error: 'Please refresh the page and try again.' }, 403);
    let actor;
    try { actor = await requireStaff('store:write'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
    try {
        const env = runtime();
        const context = { source: 'admin' as const, actor: actor.email, actorType: 'staff' as const };
        const body = await req.json().catch(() => ({})) as { code?: unknown; percentOff?: unknown; active?: unknown; remove?: unknown };

        const code = cleanPromoCode(body.code);
        if (!code) return j({ error: 'A code is 3 to 40 letters and digits, no spaces or punctuation.' }, 400);
        if (builtInCodes().includes(code)) return j({ error: code + ' is a built-in code and is managed in the store’s source, not here.' }, 409);

        // Read, change, then write back only if the row is still byte-for-byte what was read. Two
        // administrators saving at once would otherwise silently drop one of the two codes.
        const before = await readStoredPromos(env.DB);
        const current = before.rows;
        const existing = current.find(promo => promo.code === code) || null;

        let next: StoredPromo[];
        let summary: string;
        let message: string;
        if (body.remove === true) {
            if (!existing) return j({ error: code + ' is not in the list. Reload administration and try again.' }, 404);
            next = current.filter(promo => promo.code !== code);
            summary = 'Promo code ' + code + ' deleted.';
            message = code + ' deleted. Orders that already used it keep their discount and stay in the report.';
        }
        else if (body.active !== undefined && body.percentOff === undefined) {
            if (!existing) return j({ error: code + ' is not in the list. Reload administration and try again.' }, 404);
            const active = body.active === true;
            next = current.map(promo => promo.code === code ? { ...promo, active } : promo);
            summary = 'Promo code ' + code + ' turned ' + (active ? 'on' : 'off') + '.';
            message = code + (active ? ' is on. Customers can use it now.' : ' is off. Anyone typing it is told it is not valid.');
        }
        else {
            const percentOff = cleanPercentOff(body.percentOff);
            if (!percentOff) return j({ error: 'Set a whole-number discount between 1 and ' + MAX_PERCENT_OFF + '%.' }, 400);
            if (!existing && current.length >= MAX_STORED_PROMOS) return j({ error: 'There are already ' + MAX_STORED_PROMOS + ' saved codes. Delete one before adding another.' }, 409);
            const entry: StoredPromo = { code, percentOff, active: body.active !== false, created: existing?.created || Date.now(), by: actor.email.slice(0, 120) };
            next = existing ? current.map(promo => promo.code === code ? entry : promo) : [...current, entry];
            summary = existing
                ? 'Promo code ' + code + ' changed from ' + existing.percentOff + '% to ' + percentOff + '%.'
                : 'Promo code ' + code + ' created at ' + percentOff + '% off.';
            message = existing
                ? code + ' is now ' + percentOff + '% off. Carts priced before this keep the old discount until they are re-quoted.'
                : code + ' is live at ' + percentOff + '% off. Try it on a cart to confirm.';
        }

        const value = JSON.stringify(next);
        const written = before.value !== null
            ? await auditRun(env.DB, context, 'UPDATE settings SET value=? WHERE key=? AND value=?', value, PROMO_CODES_KEY, before.value)
            : await auditRun(env.DB, context, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', PROMO_CODES_KEY, value);
        if (!written.meta.changes) return j({ error: 'Promo codes changed while this page was open. Reload administration and try again.' }, 409);

        try {
            await recordChange(env.DB, {
                ...context, action: 'store.promo_code', entityType: 'setting', entityId: code, status: 'succeeded', changes: [],
                summary,
            });
        } catch { /* the code is saved; a missing history row must not suggest otherwise */ }
        return j({ custom: next, message });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
