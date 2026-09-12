import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { authReady } from '@/lib/auth';
import { runtime } from '@/lib/runtime';
export async function GET(req: NextRequest) { if (!authReady() || runtime().GOOGLE_SIGNIN_ENABLED !== 'true')
    return NextResponse.redirect(new URL('/login', req.url)); const verifier = randomBytes(48).toString('base64url'); const c = await cookies(); c.set('bm_pkce', verifier, { httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 }); const url = new URL(runtime().SUPABASE_URL + '/auth/v1/authorize'); url.search = new URLSearchParams({ provider: 'google', redirect_to: req.nextUrl.origin + '/auth/return', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256' }).toString(); return NextResponse.redirect(url); }
