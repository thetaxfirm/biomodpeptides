import { seoForOrigin } from '@/lib/seo';
import { sitemapPaths } from '@/lib/seo-policy';
import { llmsText } from '@/lib/llms-text';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const config = seoForOrigin(new URL(request.url).origin);
  if (!config.enabled) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
  return new Response(llmsText(config.publicOrigin, sitemapPaths(config)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' } });
}
