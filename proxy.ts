import { NextRequest, NextResponse } from 'next/server';
import { database, runtime } from './lib/runtime';
import { canonicalRedirect, mayIndex, seoConfig, privatePath } from './lib/seo-policy';
import { linkSlugCandidate, partnerCodeForSlug, partnerSlots } from './lib/restaurant-partners';

/**
 * A restaurant partner's own address: trybiomod.com/mariospizza15, which is that slot's discount
 * code in lower case (owner, Nov 13 2026).
 *
 * Here rather than in the catch-all page because this layer already runs on every request and
 * already holds the runtime; reaching the database from the page would have pulled the Worker
 * runtime into every harness that renders it.
 *
 * The lookup is reached only by a GET or HEAD for a single path segment that is not a name the
 * storefront already owns, so ordinary traffic -- the home page, /shop, /product/..., /api/... --
 * never pays for it. linkSlugCandidate decides that, and administration refuses to save a name it
 * rejects, so a link and the page it would have shadowed can never both exist.
 */
async function partnerRedirect(request: NextRequest): Promise<URL | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const slug = linkSlugCandidate(request.nextUrl.pathname.split('/').filter(Boolean));
  if (!slug) return null;
  try {
    return partnerCodeForSlug(await partnerSlots(database()), slug) ? new URL('/r/' + slug, request.nextUrl.origin) : null;
  }
  // An unreadable settings row must leave the storefront exactly as it was: a 404 for an unknown
  // address is correct, and is what happened before any of this existed.
  catch { return null; }
}

export async function proxy(request: NextRequest) {
  const config = seoConfig(runtime());
  const redirect = canonicalRedirect(request.nextUrl, request.method, config);
  if (redirect) return NextResponse.redirect(redirect, 301);
  // Temporary, never permanent: a slot can be renamed or switched off, and a browser must not
  // cache an address the owner may reassign tomorrow.
  const partner = await partnerRedirect(request);
  if (partner) return NextResponse.redirect(partner, 302);
  const response = NextResponse.next();
  const correctHost = config.enabled && request.nextUrl.origin === config.publicOrigin;
  if (!correctHost || !mayIndex(request.nextUrl.pathname, request.nextUrl.searchParams, config)) response.headers.set('X-Robots-Tag', correctHost && !privatePath(request.nextUrl.pathname) ? 'noindex, follow' : 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'] };
