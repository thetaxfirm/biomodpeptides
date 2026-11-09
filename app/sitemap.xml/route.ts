import { seoForOrigin } from '@/lib/seo';
import { sitemapPaths, indexableProducts } from '@/lib/seo-policy';
import { lastmodFor } from '@/lib/sitemap-lastmod';
import { imagePath } from '@/lib/catalog';
export const dynamic = 'force-dynamic';
const escapeXml = (value: string) => value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
// Product photos render as SVG <image> elements, which image crawlers do not pick up, so each
// product URL lists its catalog image (the same file as og:image and Product.image) here.
export function GET(request: Request) {
  const config = seoForOrigin(new URL(request.url).origin);
  const images = new Map(indexableProducts(config).map(p => ['/product/' + p.slug, config.publicOrigin + imagePath(p)] as const));
  const image = (path: string) => images.has(path) ? '<image:image><image:loc>' + escapeXml(images.get(path)!) + '</image:loc></image:image>' : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + sitemapPaths(config).map(path => '<url><loc>' + escapeXml(config.publicOrigin + path) + '</loc><lastmod>' + lastmodFor(path) + '</lastmod>' + image(path) + '</url>').join('') + '</urlset>';
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
