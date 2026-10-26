import { seoForOrigin } from '@/lib/seo';
import { crawlBlockedPaths } from '@/lib/seo-policy';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const config = seoForOrigin(new URL(request.url).origin);
  // Account, cart, checkout and sign-in pages stay crawlable so crawlers see their noindex
  // header and drop them; a Disallow kept Bing from reading it (/account/affiliate was indexed).
  const lines = ['User-agent: *', 'Allow: /', ...crawlBlockedPaths.map(path => 'Disallow: ' + path)];
  if (config.enabled) lines.push('', 'Sitemap: ' + config.publicOrigin + '/sitemap.xml');
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
