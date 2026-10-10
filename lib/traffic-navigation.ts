import type { TrafficEvent, TrafficPageGroup, TrafficSourceGroup } from './traffic-metrics';

// Explicit real public routes. Detail routes requiring an unreviewed record ID are omitted.
const publicRoutes: Readonly<Record<string, TrafficPageGroup>> = {
  '/': 'home', '/shop': 'catalog', '/softgels': 'catalog', '/multi-pack': 'catalog', '/presales': 'catalog',
  '/testing': 'documents', '/quality-standard': 'guide', '/choosing-a-research-supplier': 'guide', '/faq': 'guide',
  '/about': 'about', '/locations': 'locations', '/contact': 'contact', '/international-partners': 'contact',
  '/research-use-only': 'policy', '/shipping-policy': 'policy', '/returns-refunds': 'policy',
  '/terms-of-sale': 'policy', '/privacy-policy': 'policy',
};
export function trafficPageGroup(pathname: string, reviewedProductSlugs: readonly string[]): TrafficPageGroup | null {
  if (Object.prototype.hasOwnProperty.call(publicRoutes, pathname)) return publicRoutes[pathname];
  const match = /^\/product\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  return match && reviewedProductSlugs.includes(match[1]) ? 'product' : null;
}

const aiHosts = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'copilot.microsoft.com', 'gemini.google.com'];
const searchHosts = ['google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.de', 'google.fr', 'google.co.in', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'search.brave.com'];
const socialHosts = ['facebook.com', 'instagram.com', 'linkedin.com', 't.co', 'x.com', 'twitter.com', 'youtube.com', 'reddit.com', 'tiktok.com', 'pinterest.com'];
const matchesHost = (host: string, domains: readonly string[]) => domains.some(domain => host === domain || host.endsWith('.' + domain));
export function trafficSourceGroup(referrer: string, origin: string): TrafficSourceGroup {
  if (!referrer) return 'direct_or_unavailable';
  try {
    const source = new URL(referrer);
    if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) return 'direct_or_unavailable';
    if (source.origin === origin) return 'internal';
    const host = source.hostname.toLowerCase();
    if (matchesHost(host, aiHosts)) return 'ai';
    if (matchesHost(host, searchHosts)) return 'search';
    if (matchesHost(host, socialHosts)) return 'social';
    return 'external_other';
  } catch { return 'direct_or_unavailable'; }
}

export type TrafficNavigation = {
  pathname: string | null;
  initialNavigation: boolean;
  attempted: boolean;
  optedOut: boolean;
};
export const newTrafficNavigation = (): TrafficNavigation => ({ pathname: null, initialNavigation: true, attempted: false, optedOut: false });
// Only this in-memory object keeps a path. It is never transmitted or persisted.
export function observeTrafficNavigation(state: TrafficNavigation, pathname: string, search: string) {
  if (new URLSearchParams(search).getAll('measurement').includes('off')) state.optedOut = true;
  if (state.pathname !== pathname) {
    state.initialNavigation = state.pathname === null;
    state.pathname = pathname;
    state.attempted = false;
  }
}
export function consumeTrafficNavigation(state: TrafficNavigation, pageGroup: TrafficPageGroup, referrer: string, origin: string): TrafficEvent | null {
  if (state.optedOut || state.attempted) return null;
  state.attempted = true; // A failed submission is still attempted; never retry or double count.
  return { event: 'page_view', pageGroup, sourceGroup: state.initialNavigation ? trafficSourceGroup(referrer, origin) : 'internal' };
}
export function trafficPrivacyExcluded(navigator: { globalPrivacyControl?: boolean; doNotTrack?: string | null; webdriver?: boolean }, windowDoNotTrack?: string | null) {
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || windowDoNotTrack === '1' || navigator.webdriver === true;
}
