import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { one, parse, runtime, timestamp } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
export const dynamic = 'force-dynamic';

const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const auditWarning = ' Change history could not record the final result. Do not repeat this action just to update history.';

/**
 * Marks a staff test order as what it is, or puts it back (owner, Nov 17 2026: "ash is not a real
 * order that is our staff testing the system so remove it").
 *
 * Until now there was no way to say this. A test order placed through the real checkout stayed a
 * customer order forever: it sat in the working queues waiting for a decision nobody could make,
 * and -- the part that is easy to miss -- it counted in the sales, promo and overview figures as a
 * real sale. Marking it moves it to Internal tests and out of every revenue number.
 *
 * It changes nothing else. The payment, the label and the customer record stay exactly as they
 * are, because a test order can still have cost real money, and hiding that would be worse than
 * leaving the row alone. Owner-level by default (this file is not in adminActionPermission), since
 * it is a change to what the store reports as revenue.
 */
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin)
        return j({ error: 'Please refresh the page and try again.' }, 403);
    // Outside the try, so an authentication failure is never relayed as a 400 carrying its own
    // message: that would tell any signed-in customer whether they are staff.
    let actor;
    try { actor = await requireStaff('team:manage'); }
    catch { return j({ error: 'Owner sign-in required.' }, 403); }

    try {
        const env = runtime();
        const context = { source: 'admin' as const, actor: actor.email, actorType: 'staff' as const, action: 'order.internal_test' };
        const run = (sql: string, ...values: (string | number | null)[]) => auditRun(env.DB, context, sql, ...values);
        const body = await req.json().catch(() => ({})) as { orderId?: unknown; internalTest?: unknown; note?: unknown };

        const orderId = typeof body.orderId === 'string' && /^[a-f0-9-]{36}$/.test(body.orderId) ? body.orderId : '';
        if (!orderId) return j({ error: 'Choose an order.' }, 400);
        if (typeof body.internalTest !== 'boolean') return j({ error: 'Say whether this is an internal test.' }, 400);
        const wanted: boolean = body.internalTest;
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

        const order = await one<{ id: string; status: string; data: string }>('SELECT id,status,data FROM orders WHERE id=?', orderId);
        if (!order) return j({ error: 'Order not found.' }, 404);
        const data = parse<Record<string, any>>(order.data, {});
        const number = '#' + order.id.slice(0, 8).toUpperCase();
        const already = data.internalTest === true;
        if (already === wanted)
            return j({ message: number + (already ? ' is already marked an internal test.' : ' is already a customer order.') });

        const record = async (status: 'attempted' | 'succeeded' | 'failed', summary: string) => {
            try {
                await recordChange(env.DB, { ...context, entityType: 'order', entityId: order.id, status, summary,
                    changes: [{ field: 'internalTest', before: already, after: wanted }] });
                return true;
            }
            catch { return false; }
        };
        await record('attempted', 'Requested to mark ' + number + (wanted ? ' an internal test.' : ' a customer order.') + (note ? ' ' + note : ''));

        // WRITTEN as JSON true, because the server code compares it with === true after parsing
        // the row. READ BACK as 1, because that is what json_extract gives for a JSON true -- so
        // the guards below compare against 1, not against json('true'), which is the text 'true'
        // and never matches. Guarded on the value just read, so a concurrent change is reported
        // rather than silently overwritten.
        const saved = wanted
            ? await run("UPDATE orders SET data=json_set(data,'$.internalTest',json('true'),'$.internalTestBy',?,'$.internalTestAt',?),updated=? WHERE id=? AND coalesce(json_extract(data,'$.internalTest'),0)=0",
                actor.email, Date.now(), timestamp(), order.id)
            : await run("UPDATE orders SET data=json_remove(data,'$.internalTest','$.internalTestBy','$.internalTestAt'),updated=? WHERE id=? AND json_extract(data,'$.internalTest')=1",
                timestamp(), order.id);
        if (!saved.meta.changes) {
            await record('failed', number + ' changed while this was being saved. Nothing was written.');
            return j({ error: 'This order changed while you were working on it. Refresh and try again.' }, 409);
        }
        const recorded = await record('succeeded', number + (wanted
            ? ' marked an internal test: it leaves the working queues and every revenue figure.'
            : ' returned to the customer orders and the revenue figures.'));
        return j({ message: number + (wanted
            ? ' marked an internal test. It leaves the working queues and is no longer counted as a sale. Its payment and label are unchanged.'
            : ' is a customer order again and counts as a sale. Its payment and label are unchanged.') + (recorded ? '' : auditWarning) });
    }
    catch { return j({ error: 'That could not be saved. Nothing was changed.' }, 400); }
}
