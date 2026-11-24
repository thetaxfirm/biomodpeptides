import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/auth';
import { requireSiteRequester } from '@/lib/site-updates-auth';
import { database } from '@/lib/runtime';
import { attachFile, readFile, MAX_FILE_BYTES, SiteUpdateError } from '@/lib/site-updates';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = () => j({ error: 'Administrator sign-in required.' }, 403);
// Files attached to a website update request. Stored privately; only the requester and owners can
// read one back, and always as a download, never rendered by this site.
export async function GET(req: NextRequest) {
    let actor;
    try { actor = await requireSiteRequester(); } catch { return denied(); }
    try {
        const file = await readFile(database(), actor, req.nextUrl.searchParams.get('id'));
        return new NextResponse(file.bytes as unknown as BodyInit, { headers: {
            'Content-Type': 'application/octet-stream', 'Content-Length': String(file.bytes.byteLength),
            'Content-Disposition': 'attachment; filename="' + file.filename.replace(/[^A-Za-z0-9 ._()\-]/g, '_') + '"',
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
        } });
    } catch (e) { return j({ error: e instanceof SiteUpdateError ? e.message : 'File not found.' }, e instanceof SiteUpdateError ? e.status : 404); }
}
// One file per call, sent as the raw request body: ?update=<request id>&name=<file name>.
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin) return j({ error: 'Please refresh the page and try again.' }, 403);
    let actor;
    try { actor = await requireSiteRequester(); } catch { return denied(); }
    try {
        await rateLimit('site-update-file:' + actor.id, 60);
        const declared = Number(req.headers.get('content-length') || 0);
        if (declared > MAX_FILE_BYTES) return j({ error: 'That file is larger than 16 MB. Send a smaller copy.' }, 413);
        const bytes = new Uint8Array(await req.arrayBuffer());
        return j(await attachFile(database(), actor, req.nextUrl.searchParams.get('update'), req.nextUrl.searchParams.get('name'), bytes));
    } catch (e) {
        if (e instanceof SiteUpdateError) return j({ error: e.message }, e.status);
        return j({ error: e instanceof Error && /Too many requests/.test(e.message) ? e.message : 'That file did not upload. Try again.' }, 400);
    }
}
