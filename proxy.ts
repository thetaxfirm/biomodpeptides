import { NextRequest, NextResponse } from 'next/server';
import { runtime } from './lib/runtime';
import { canonicalRedirect, mayIndex, seoConfig, privatePath } from './lib/seo-policy';

export function proxy(request: NextRequest) {
  const config = seoConfig(runtime());
  const redirect = canonicalRedirect(request.nextUrl, request.method, config);
  if (redirect) return NextResponse.redirect(redirect, 301);
  const response = NextResponse.next();
  const correctHost = config.enabled && request.nextUrl.origin === config.publicOrigin;
  if (!correctHost || !mayIndex(request.nextUrl.pathname, request.nextUrl.searchParams, config)) response.headers.set('X-Robots-Tag', correctHost && !privatePath(request.nextUrl.pathname) ? 'noindex, follow' : 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'] };
