// Sitemap <lastmod> dates. Bing uses lastmod to decide what to recrawl, and both Bing
// and Google ignore it once it proves unreliable, so each date must be the day that
// page's visible content last changed in a release. Bump the entry in the same commit
// that changes a page; never set every page to today by default.
import { pressReleases } from './press-releases';

// The sitewide header last changed on October 17, 2026: 92d01ce renamed the "Nasal & spray"
// menu item to "Sprays" on every page. A sitewide change dates every page, so no entry below
// can be older than this (lastmodFor takes the later of the two).
export const siteLastmod = '2026-10-17';
// October 17: da848db added free USPS Priority Mail at $250 and the 2 p.m. Pacific same-day
// wording to every product page; 589ae41 moved the product images to WebP.
export const productLastmod = '2026-10-17';
export const pageLastmod: Record<string, string> = {
  // October 14: initial homepage cards now include every publication-reviewed vial.
  '/': '2026-10-14',
  // fb54b09: batch status wording on shop cards, the FAQ, batch library and COA guide.
  '/shop': '2026-10-13',
  '/testing': '2026-10-13',
  '/news/biomod-peptides-online-store-trybiomod': '2026-10-13',
  // 9595696 (October 14): separate-checkout preorder wording; 1ef1cb4 added the vial lot field.
  '/shipping-policy': '2026-10-14',
  '/contact': '2026-10-14',
  // 628f8c0 (October 16): these four pages now end with the research vial index.
  '/faq': '2026-10-16',
  '/about': '2026-10-16',
  '/quality-standard': '2026-10-16',
  '/choosing-a-research-supplier': '2026-10-16',
};

const later = (a: string, b: string) => (a > b ? a : b);

export function lastmodFor(path: string) {
  if (pageLastmod[path]) return later(pageLastmod[path], siteLastmod);
  if (path.startsWith('/product/')) return later(productLastmod, siteLastmod);
  const release = pressReleases.find(r => '/news/' + r.slug === path);
  return release ? later(release.date, siteLastmod) : siteLastmod;
}
