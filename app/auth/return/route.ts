import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authCall, storeAuth } from '@/lib/auth';
export async function GET(req: NextRequest) { const c = await cookies(); const verifier = c.get('bm_pkce')?.value; const code = req.nextUrl.searchParams.get('code'); c.delete('bm_pkce'); if (!verifier || !code)
    return NextResponse.redirect(new URL('/login', req.url)); try {
    const d = await authCall('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
    await storeAuth(d, req.nextUrl.protocol === 'https:');
    return NextResponse.redirect(new URL('/account/profile', req.url));
}
catch {
    return NextResponse.redirect(new URL('/login?error=google', req.url));
} }
