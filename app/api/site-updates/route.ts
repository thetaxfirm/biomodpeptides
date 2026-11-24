import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/auth';
import { requireSiteRequester } from '@/lib/site-updates-auth';
import { database } from '@/lib/runtime';
import { products } from '@/lib/catalog';
import { normalizeLot } from '@/lib/coa-delivery';
import { addNote, cancelUpdate, createDraft, decideUpdate, listUpdates, submitDraft, SiteUpdateError } from '@/lib/site-updates';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = () => j({ error: 'Administrator sign-in required.' }, 403);
// The name as staff know it, with the size only when it is short and not already in the name.
const productLabel = (p: { name: string; sizes: string[] }) => { const size = (p.sizes[0] || '').replace(/\s*\/\s*(?:vial|bottle)$/i, ''); return p.name + (size && size.length <= 12 && !p.name.toLowerCase().includes(size.toLowerCase()) ? ' ' + size : ''); };
// Website update requests (owner request, Nov 24 2026). Nothing here changes the storefront: a
// request is a written instruction plus files, carried out later under docs/site-updates-lane-v1.md.
export async function GET() {
    let actor;
    try { actor = await requireSiteRequester(); } catch { return denied(); }
    try {
        return j({ updates: await listUpdates(database(), actor), owner: actor.role === 'owner', products: products.map(p => ({ id: p.id, name: productLabel(p) })).sort((a, b) => a.name.localeCompare(b.name)) });
    } catch { return j({ error: 'Website updates could not load. Refresh and try again.' }, 500); }
}
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin) return j({ error: 'Please refresh the page and try again.' }, 403);
    // Outside the try, so a failed sign-in never reveals which permission is missing.
    let actor;
    try { actor = await requireSiteRequester(); } catch { return denied(); }
    try {
        const db = database();
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        if (body.op === 'create') {
            await rateLimit('site-update:' + actor.id, 20);
            const product = products.find(p => p.id === Number(body.productId));
            const lot = typeof body.lot === 'string' && body.lot.trim() ? normalizeLot(body.lot) : '';
            if (lot === null) return j({ error: 'Enter the lot exactly as printed on the vial label, for example 301-10-0001.' }, 400);
            return j(await createDraft(db, actor, { kind: body.kind, product: product ? { id: product.id, name: productLabel(product) } : null, lot, message: body.message }));
        }
        if (body.op === 'submit') return j(await submitDraft(db, actor, body.id));
        if (body.op === 'note') { await rateLimit('site-update-note:' + actor.id, 40); return j(await addNote(db, actor, body.id, body.body)); }
        if (body.op === 'cancel') return j(await cancelUpdate(db, actor, body.id));
        if (body.op === 'approve' || body.op === 'decline') return j(await decideUpdate(db, actor, body.id, body.op === 'approve', body.body));
        return j({ error: 'Not found.' }, 404);
    } catch (e) {
        if (e instanceof SiteUpdateError) return j({ error: e.message }, e.status);
        return j({ error: e instanceof Error && /Too many requests/.test(e.message) ? e.message : 'That did not save. Refresh and try again.' }, 400);
    }
}
