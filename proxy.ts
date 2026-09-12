import { NextRequest, NextResponse } from 'next/server';
import { runtime } from './lib/runtime';
import { mayIndex, seoConfig } from './lib/seo-policy';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const config = seoConfig(runtime());
  const correctHost = config.enabled && request.nextUrl.origin === config.publicOrigin;
  if (!correctHost || !mayIndex(request.nextUrl.pathname, request.nextUrl.searchParams, config)) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'] };
