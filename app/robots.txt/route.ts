import { seoForOrigin } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const config = seoForOrigin(new URL(request.url).origin);
  // Crawlable public HTML lets crawlers see the noindex meta and response header.
  const lines = ['User-agent: *', 'Allow: /', ...['/account', '/admin', '/api/', '/auth/', '/cart', '/checkout', '/payment/', '/login', '/register', '/forgot-password', '/reset-password'].map(path => 'Disallow: ' + path)];
  if (config.enabled) lines.push('', 'Sitemap: ' + config.publicOrigin + '/sitemap.xml');
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
