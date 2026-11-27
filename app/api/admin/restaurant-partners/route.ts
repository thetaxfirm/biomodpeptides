import { settingsSnapshot, saveRawSettingsSnapshots, SettingsConflict } from '@/lib/settings-version';
import { normalizeStoredPromos, PROMO_CODES_KEY } from '@/lib/promo-codes';
import { promoOwners } from '@/lib/promo-ownership';
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { runtime } from '@/lib/runtime';
import { recordChange } from '@/lib/change-history';
import {
    BUSINESS_PARTNERS_KEY, PARTNER_SLOTS, MAX_PERCENT_OFF,
    readPartners, normalizePartners, slotReady, partnerPromoChanges, parsePartners, type PartnerSlot,
} from '@/lib/restaurant-partners';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** The twenty business slots. Filling one in names a link and a code; the switch decides whether
 * it prices anything. Kept apart from the general promo code list on purpose (owner, Nov 13 2026). */
export async function GET() {
    try {
        await requireStaff('store:write');
        const { rows } = await readPartners(runtime().DB);
        return j({ slots: rows, maxPercentOff: MAX_PERCENT_OFF, total: PARTNER_SLOTS });
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
        const body = await req.json().catch(() => ({})) as { slot?: unknown; name?: unknown; slug?: unknown; code?: unknown; percentOff?: unknown; active?: unknown; clear?: unknown };

        const slot = Number(body.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > PARTNER_SLOTS)
            return j({ error: 'Choose one of the ' + PARTNER_SLOTS + ' slots.' }, 400);

        // Read, change, write back only if the row is byte-for-byte what was read. Two people
        // filling slots at once would otherwise silently drop one of the two businesses.
        const [partnerSnapshot, promoSnapshot] = await Promise.all([settingsSnapshot(env.DB, BUSINESS_PARTNERS_KEY), settingsSnapshot(env.DB, PROMO_CODES_KEY)]);
        const current = parsePartners(partnerSnapshot.value);
        const promoRows = normalizeStoredPromos(JSON.parse(promoSnapshot.value || '[]'));
        const existing = current[slot - 1];

        const draft: Record<string, unknown> = body.clear === true
            ? { slot, name: '', previous: [existing.code, ...existing.previous].filter(Boolean) }
            : {
                slot,
                name: body.name !== undefined ? body.name : existing.name,
                // An empty string means "derive it from the name again", which is how a rename
                // follows through to the link and the code.
                slug: body.slug !== undefined ? body.slug : existing.slug,
                code: body.code !== undefined ? body.code : existing.code,
                percentOff: body.percentOff !== undefined ? body.percentOff : existing.percentOff,
                active: body.active !== undefined ? body.active === true : existing.active,
                previous: existing.previous,
                updated: Date.now(),
                by: actor.email,
            };
        // Derive once to see which code the slot lands on, then remember the one it is leaving so
        // a rename retires it instead of abandoning it live.
        const derived = normalizePartners(current.map(row => row.slot === slot ? draft : row))[slot - 1];
        if (existing.code && existing.code !== derived.code)
            draft.previous = [existing.code, ...existing.previous];
        const next = normalizePartners(current.map(row => row.slot === slot ? draft : row));
        const saved = next[slot - 1];

        if (body.active === true && !slotReady(saved))
            return j({ error: 'A slot needs a business name and a discount between 1 and ' + MAX_PERCENT_OFF + '% before it can be switched on.' }, 400);
        if (saved.name && !saved.slug)
            return j({ error: 'That name matches a page the site already serves, so the link would not work. Use a different name for this slot.' }, 409);
        if (saved.name && !saved.code)
            return j({ error: 'That name matches a built-in store code. Edit the code for this slot so it is different.' }, 409);

        const existingCodes = new Set(current.flatMap(row => [row.code, ...row.previous]));
        if (saved.code && !existingCodes.has(saved.code)) {
            const managed = (await promoOwners(env.DB))[saved.code];
            if (managed || promoRows.some(row => row.code === saved.code)) return j({ error: 'This code already belongs to another promotion or affiliate. Choose a different business name.' }, 409);
        }
        const sync = partnerPromoChanges(next, promoRows, actor.email);
        // Slot state and checkout pricing either both save or neither does.
        await saveRawSettingsSnapshots(env.DB, [
            { before: partnerSnapshot, value: JSON.stringify(next) },
            { before: promoSnapshot, value: JSON.stringify(sync.rows) },
        ], context);

        const summary = body.clear === true ? 'Business slot ' + slot + ' cleared.'
            : saved.active ? 'Business slot ' + slot + ' (' + saved.name + ') is on at ' + saved.percentOff + '% with code ' + saved.code + '.'
            : 'Business slot ' + slot + (saved.name ? ' (' + saved.name + ')' : '') + ' saved, switched off.';
        try {
            // The event type keeps its original name on purpose: it is the stable identifier the
            // change log groups by, and renaming it would split this programme's history in two.
            await recordChange(env.DB, { ...context, action: 'store.restaurant_partner', entityType: 'setting', entityId: String(slot), status: 'succeeded', changes: [], summary });
        } catch { /* the slot is saved; a missing history row must not suggest otherwise */ }

        return j({
            slots: next, live: sync.live, retired: sync.retired,
            message: body.clear === true ? 'Slot ' + slot + ' cleared. Its code is switched off and kept in the promo list.'
                : saved.active ? saved.name + ' is live at ' + saved.percentOff + '% off. Link: trybiomod.com/' + saved.slug + ' · code ' + saved.code
                : 'Saved. ' + (saved.name || 'Slot ' + slot) + ' is switched off, so nothing is discounted yet.',
        });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, e instanceof SettingsConflict ? 409 : 400);
    }
}
