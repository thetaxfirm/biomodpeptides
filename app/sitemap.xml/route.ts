import { seoForOrigin } from '@/lib/seo';
import { sitemapPaths } from '@/lib/seo-policy';
export const dynamic = 'force-dynamic';
const escapeXml = (value: string) => value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
export function GET(request: Request) {
  const config = seoForOrigin(new URL(request.url).origin);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + sitemapPaths(config).map(path => '<url><loc>' + escapeXml(config.publicOrigin + path) + '</loc></url>').join('') + '</urlset>';
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
