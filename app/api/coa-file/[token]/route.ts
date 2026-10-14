import { NextRequest, NextResponse } from 'next/server';
import { openCoaLink } from '@/lib/coa-link';
import { runtime } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
// Private COA link from a "Request by email" message. Serves only the verified original PDF.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const file = await openCoaLink(runtime() as any, token).catch(() => null);
    const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
    if (!file) return new NextResponse('This COA link is invalid or has expired. Request the COA again from the product page.', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
    return new NextResponse(file.bytes, { status: 200, headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file.filename.replace(/["\\]/g, '')}"`, 'X-Content-Type-Options': 'nosniff' } });
}
