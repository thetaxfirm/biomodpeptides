import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { runtime, timestamp } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
import { cleanRecipients, orderAlertRecipients, orderNotifyRecipients, ORDER_ALERT_KEY } from '@/lib/order-summary';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Who gets told about a new paid order, and about the daily parcel digest. Kept out of the store
 * config on purpose: the cron that sends the digest has no request runtime, so this list has to be
 * readable straight from D1 (owner, Oct 20 2026).
 */
export async function GET() {
    try {
        await requireStaff('store:write');
        const env = runtime();
        const saved = await orderAlertRecipients(env as never);
        const fallback = orderNotifyRecipients(env as never);
        return j({ recipients: saved, usingFallback: saved.length > 0 && saved.join() === fallback.join() && fallback.length > 0, deployed: fallback });
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
        const body = await req.json().catch(() => ({})) as { recipients?: unknown };
        if (typeof body.recipients !== 'string') return j({ error: 'Send the list as text.' }, 400);
        const recipients = cleanRecipients(body.recipients);
        const dropped = String(body.recipients).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).length - recipients.length;
        // The addresses themselves are the change, and they are staff contact details rather than a
        // customer's, so the count goes in the history and the list does not.
        await auditRun(env.DB, context, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ORDER_ALERT_KEY, recipients.join(','));
        try {
            await recordChange(env.DB, {
                ...context, action: 'store.order_alerts', entityType: 'setting', entityId: ORDER_ALERT_KEY, status: 'succeeded', changes: [],
                summary: 'Order alert recipients saved: ' + recipients.length + (recipients.length === 1 ? ' address' : ' addresses') + '.',
            });
        } catch { /* the list is saved; a missing history row must not suggest otherwise */ }
        return j({
            recipients,
            message: recipients.length
                ? recipients.length + (recipients.length === 1 ? ' address' : ' addresses') + ' saved.' + (dropped > 0 ? ' ' + dropped + ' entr' + (dropped === 1 ? 'y was' : 'ies were') + ' not a valid address and ' + (dropped === 1 ? 'was' : 'were') + ' dropped.' : '')
                : 'List cleared. New-order alerts fall back to the addresses set in Cloudflare.' + (dropped > 0 ? ' Nothing you typed looked like an address.' : ''),
        });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
