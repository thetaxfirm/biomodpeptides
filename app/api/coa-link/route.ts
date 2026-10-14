import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/auth';
import { coaHash } from '@/lib/coa-delivery';
import { CoaLinkError, sendCoaLink } from '@/lib/coa-link';
import { runtime } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
// "Request by email": the customer types an email and gets a private COA link right away.
export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin) return j({ error: 'Please refresh the page and try again.' }, 403);
    const body = await req.json().catch(() => ({})) as { productId?: unknown; email?: unknown };
    try {
        const ip = req.headers.get('cf-connecting-ip') || 'unknown';
        await rateLimit('coa-link:ip:' + ip, 8);
        if (typeof body.email === 'string') await rateLimit('coa-link:email:' + (await coaHash(body.email.trim().toLowerCase())).slice(0, 32), 4);
        const sent = await sendCoaLink(runtime() as any, { productId: body.productId, email: body.email });
        return j({ message: `Sent. Check your email for the ${sent.productName} COA (lot ${sent.lot}).` });
    } catch (e) {
        if (e instanceof CoaLinkError) return j({ error: e.message }, e.status);
        if (e instanceof Error && /Too many requests/.test(e.message)) return j({ error: 'Too many requests. Please wait a few minutes.' }, 429);
        return j({ error: 'The COA could not be sent. Try again, or contact us and we will send it.' }, 500);
    }
}
