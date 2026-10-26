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

const aiHosts = ['chatgpt.com', 'chat.openai.com', 'openai.com', 'perplexity.ai', 'claude.ai', 'copilot.microsoft.com', 'copilot.cloud.microsoft',
  'edgeservices.bing.com', 'gemini.google.com', 'bard.google.com', 'notebooklm.google.com', 'chat.mistral.ai', 'meta.ai', 'grok.com',
  'chat.deepseek.com', 'you.com', 'phind.com', 'poe.com', 'kagi.com', 'duck.ai', 'character.ai'];
// AI apps often strip the referrer but tag outbound links (ChatGPT adds utm_source=chatgpt.com).
// The value is read in the browser only to pick a group; it is never transmitted or stored.
const aiUtmSources = [...aiHosts, 'chatgpt', 'openai', 'perplexity', 'claude', 'anthropic', 'copilot', 'gemini', 'mistral', 'grok', 'deepseek', 'phind'];
const searchHosts = ['google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.de', 'google.fr', 'google.co.in', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'search.brave.com'];
const socialHosts = ['facebook.com', 'instagram.com', 'linkedin.com', 't.co', 'x.com', 'twitter.com', 'youtube.com', 'reddit.com', 'tiktok.com', 'pinterest.com'];
const matchesHost = (host: string, domains: readonly string[]) => domains.some(domain => host === domain || host.endsWith('.' + domain));
function aiUtmSource(search: string) {
  return new URLSearchParams(search).getAll('utm_source').some(value => {
    const source = value.trim().toLowerCase().replace(/^www\./, '');
    return aiUtmSources.some(known => source === known || source.endsWith('.' + known));
  });
}
export function trafficSourceGroup(referrer: string, origin: string, search = ''): TrafficSourceGroup {
  if (aiUtmSource(search)) {
    try { if (referrer && new URL(referrer).origin === origin) return 'internal'; } catch { /* Fall through to the tagged source. */ }
    return 'ai';
  }
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
  shoppingAttempted: Set<string>;
};
export const newTrafficNavigation = (): TrafficNavigation => ({ pathname: null, initialNavigation: true, attempted: false, optedOut: false, shoppingAttempted: new Set() });
// Only this in-memory object keeps a path. It is never transmitted or persisted.
export function observeTrafficNavigation(state: TrafficNavigation, pathname: string, search: string) {
  if (new URLSearchParams(search).getAll('measurement').includes('off')) state.optedOut = true;
  if (state.pathname !== pathname) {
    state.initialNavigation = state.pathname === null;
    state.pathname = pathname;
    state.attempted = false;
    state.shoppingAttempted.clear();
  }
}
export function consumeTrafficNavigation(state: TrafficNavigation, pageGroup: TrafficPageGroup, referrer: string, origin: string, search = ''): TrafficEvent | null {
  if (state.optedOut || state.attempted) return null;
  state.attempted = true; // A failed submission is still attempted; never retry or double count.
  return { event: 'page_view', pageGroup, sourceGroup: state.initialNavigation ? trafficSourceGroup(referrer, origin, search) : 'internal' };
}
export function trafficPrivacyExcluded(navigator: { globalPrivacyControl?: boolean; doNotTrack?: string | null; webdriver?: boolean }, windowDoNotTrack?: string | null) {
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || windowDoNotTrack === '1' || navigator.webdriver === true;
}

// Both collectors share one in-memory document state. An opt-out survives route
// changes and component remounts; nothing is written to browser storage.
const documents = new WeakMap<Document, TrafficNavigation>();
export function documentTrafficNavigation(document: Document, pathname: string, search: string): TrafficNavigation {
  let state = documents.get(document);
  if (!state) { state = newTrafficNavigation(); documents.set(document, state); }
  observeTrafficNavigation(state, pathname, search);
  return state;
}
