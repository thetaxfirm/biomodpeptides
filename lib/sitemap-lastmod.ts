// Sitemap <lastmod> dates. Bing uses lastmod to decide what to recrawl, and both Bing
// and Google ignore it once it proves unreliable, so each date must be the day that
// page's visible content last changed in a release. Bump the entry in the same commit
// that changes a page; never set every page to today by default.
import { pressReleases } from './press-releases';

// The sitewide header and footer last changed on October 12, 2026 (store-chrome).
export const siteLastmod = '2026-10-12';
// fb54b09 changed product questions and batch status wording on every product page.
export const productLastmod = '2026-10-13';
export const pageLastmod: Record<string, string> = {
  // fb54b09: batch status wording on home and shop cards, the FAQ, batch library and COA guide.
  '/': '2026-10-13',
  '/shop': '2026-10-13',
  '/faq': '2026-10-13',
  '/testing': '2026-10-13',
  '/quality-standard': '2026-10-13',
  '/news/biomod-peptides-online-store-trybiomod': '2026-10-13',
};

export function lastmodFor(path: string) {
  if (pageLastmod[path]) return pageLastmod[path];
  if (path.startsWith('/product/')) return productLastmod;
  const release = pressReleases.find(r => '/news/' + r.slug === path);
  return release && release.date > siteLastmod ? release.date : siteLastmod;
}
