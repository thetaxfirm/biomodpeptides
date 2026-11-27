import { promoOwners } from '@/lib/promo-ownership';
import { settingsSnapshot, saveSettingsSnapshot, SettingsConflict } from '@/lib/settings-version';
import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { runtime } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
import { activePromotions } from '@/lib/promotions';
import { builtInCodes, cleanPercentOff, cleanPromoCode, MAX_PERCENT_OFF, MAX_STORED_PROMOS, PROMO_CODES_KEY, BUILTIN_PROMO_OVERRIDES_KEY, normalizeStoredPromos, normalizeBuiltInOverrides, type StoredPromo } from '@/lib/promo-codes';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** Explicit owner overrides preserve source defaults until an audited edit is saved. */
export async function GET() {
    let actor;
    try { actor = await requireStaff('store:write'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
    try {
        const env = runtime();
        const [owners, manualVersion, builtinVersion] = await Promise.all([promoOwners(env.DB), settingsSnapshot(env.DB, PROMO_CODES_KEY), settingsSnapshot(env.DB, BUILTIN_PROMO_OVERRIDES_KEY)]);
        const stored = { rows: normalizeStoredPromos(JSON.parse(manualVersion.value || '[]')) }, overrides = { rows: normalizeBuiltInOverrides(JSON.parse(builtinVersion.value || '[]')) };
        return j({ builtIn: activePromotions().map(base => ({ ...base, active: true, created: 0, by: '', expiresAt: null, ...overrides.rows.find(row => row.code === base.code) })), custom: stored.rows, owners, owner: actor.role === 'owner', versions: { manual: manualVersion.version, builtin: builtinVersion.version }, maxPercentOff: MAX_PERCENT_OFF, limit: MAX_STORED_PROMOS });
    } catch { return j({ error: 'Promo code settings could not load. Retry when the connection is restored.' }, 503); }
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
        const body = await req.json().catch(() => ({})) as { code?: unknown; percentOff?: unknown; active?: unknown; remove?: unknown; expiresAt?: unknown; reason?: unknown; version?: unknown };

        const code = cleanPromoCode(body.code);
        if (!code) return j({ error: 'A code is 3 to 40 letters and digits, no spaces or punctuation.' }, 400);
        const managed = (await promoOwners(env.DB))[code];
        if (managed) return j({ error: code + ' belongs to ' + managed.label + '. Change it through ' + (managed.kind === 'business' ? 'Businesses' : 'the affiliate offer') + ' so its terms and discount stay together.', managed }, 409);
        const expiresAt = body.expiresAt === undefined ? undefined : body.expiresAt === null ? null : Number(body.expiresAt);
        if (expiresAt !== undefined && expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) return j({ error: 'Choose a future expiry date or leave it blank.' }, 400);
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
        if (builtInCodes().includes(code)) {
            if (actor.role !== 'owner') return j({ error: code + ' is a built-in code. Only an owner can change its terms.' }, 409);
            if (reason.length < 8) return j({ error: 'Record a reason of at least 8 characters before changing an existing built-in code.' }, 400);
            const snapshot = await settingsSnapshot(env.DB, BUILTIN_PROMO_OVERRIDES_KEY, body.version);
            const previous = { rows: normalizeBuiltInOverrides(JSON.parse(snapshot.value || '[]')) };
            const base = activePromotions().find(row => row.code === code)!;
            const existing = previous.rows.find(row => row.code === code);
            const percentOff = body.percentOff === undefined ? existing?.percentOff ?? base.percentOff : cleanPercentOff(body.percentOff);
            if (!percentOff) return j({ error: 'Set a whole-number discount between 1 and ' + MAX_PERCENT_OFF + '%.' }, 400);
            const entry: StoredPromo = { code, percentOff, active: body.remove === true ? false : body.active === undefined ? existing?.active ?? true : body.active === true, expiresAt: expiresAt === undefined ? existing?.expiresAt ?? null : expiresAt, created: existing?.created || Date.now(), by: actor.email, reason };
            const rows = [...previous.rows.filter(row => row.code !== code), entry];
            await saveSettingsSnapshot(env.DB, snapshot, rows, context);
            try { await recordChange(env.DB, { ...context, action: 'store.promo_code', entityType: 'setting', entityId: code, status: 'succeeded', changes: [], summary: `Built-in code ${code}: ${entry.active ? percentOff + '% off' : 'retired'}${entry.expiresAt ? '; expires ' + new Date(entry.expiresAt).toISOString() : ''}. Reason: ${reason}` }); } catch { /* The audited settings write already committed. */ }
            return j({ message: code + ' saved. Historical orders and accepted partner terms are unchanged.' });
        }

        // Read, change, then write back only if the row is still byte-for-byte what was read. Two
        // administrators saving at once would otherwise silently drop one of the two codes.
        const snapshot = await settingsSnapshot(env.DB, PROMO_CODES_KEY, body.version);
        const before = { value: snapshot.value, rows: normalizeStoredPromos(JSON.parse(snapshot.value || '[]')) };
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
            const entry: StoredPromo = { code, percentOff, active: body.active !== false, created: existing?.created || Date.now(), by: actor.email.slice(0, 120), ...(expiresAt === undefined ? existing?.expiresAt === undefined ? {} : { expiresAt: existing.expiresAt } : { expiresAt }), ...(reason ? { reason } : {}) };
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
                summary: summary + (reason ? ' Reason: ' + reason : ''),
            });
        } catch { /* the code is saved; a missing history row must not suggest otherwise */ }
        return j({ custom: next, message });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, e instanceof SettingsConflict ? 409 : 400);
    }
}
