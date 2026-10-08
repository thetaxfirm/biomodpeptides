export const AUTH_RETURN_COOKIE = 'bm_auth_return';
export const ANONYMOUS_SESSION_COOKIE = 'bm_anonymous_session';
export const AUTH_RETURN_MAX_AGE = 60 * 60;
export const authRoutes = ['login', 'register', 'forgot-password', 'reset-password'] as const;
type AuthRoute = typeof authRoutes[number];

/** Only same-site relative paths may survive an authentication round trip. */
export function safeAuthReturn(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '/account';
  let decoded = value;
  for (let pass = 0; pass < 5; pass++) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return '/account';
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return '/account'; }
    if (next === decoded) {
      try {
        const destination = new URL(value, 'https://biomod.invalid');
        if (destination.origin !== 'https://biomod.invalid' || destination.pathname.startsWith('//')) return '/account';
        const canonicalPath = decodeURIComponent(destination.pathname);
        if (canonicalPath.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(canonicalPath)) return '/account';
        return destination.pathname + destination.search + destination.hash;
      } catch { return '/account'; }
    }
    decoded = next;
  }
  return '/account';
}

export function authLink(route: AuthRoute, returnTo: unknown): string {
  const destination = safeAuthReturn(returnTo);
  return '/' + route + (destination === '/account' ? '' : '?returnTo=' + encodeURIComponent(destination));
}

/** End the browser session without deleting either stored cart. */
export function clearAuthSessionCookies(cookieJar: { delete: (name: string) => unknown }) {
  for (const name of ['bm_access', 'bm_refresh', AUTH_RETURN_COOKIE, 'bm_session', ANONYMOUS_SESSION_COOKIE]) cookieJar.delete(name);
}

// Bind a fallback to this exact anonymous session so transient auth failures do
// not repeatedly erase its cart while old identity cookies remain in the browser.
export function needsAnonymousSession(hasCustomer: boolean, hasIdentityCookies: boolean, claimedOwner: string | null, sessionId: string, anonymousSession: string | undefined): boolean {
  return !hasCustomer && Boolean(claimedOwner || (hasIdentityCookies && anonymousSession !== sessionId));
}
export function needsAccountSession(priorOwner: string | undefined, nextOwner: string, claimedOwner: string | null, hasIdentityCookies: boolean, sessionId: string, anonymousSession: string | undefined): boolean {
  return Boolean((priorOwner && priorOwner !== nextOwner) || (claimedOwner && claimedOwner !== nextOwner) || (!priorOwner && hasIdentityCookies && anonymousSession !== sessionId));
}
