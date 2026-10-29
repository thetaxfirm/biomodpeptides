import { products, compound, size, productFormat, type Product } from './catalog';

import specificationReviews from './product-specification-review-v1.json';
import { pressReleases } from './press-releases';

export const previewOrigin = 'https://trybiomod.com';
export const reviewedOn = '2026-10-08';
export const pageRecords: Record<string, { title: string; description: string; eligible: boolean; name?: string }> = {
  '/': { title: 'Buy Research Compounds | Biomod Research Supply Company', description: 'Buy research compounds from Biomod: BPC-157 10mg, MOTS-c, SS-31 and more, with available batch COAs and 1, 3, 5 and 10-packs. Research use only.', eligible: true },
  '/softgels': { title: 'The Original RUO Softgel™ by BIOMOD', description: 'Explore BIOMOD RUO softgels with BPC-157 Arginate, KPV, GHK-Cu, AHK-Cu, Pinealon and Epitalon. Compare formulations and enteric design.', eligible: true },
  '/shop': { title: 'Buy Research Compounds Online', description: 'Buy research compounds for laboratory research: BPC-157, MOTS-c, SS-31, KPV and more. Compare vial sizes, per-mg pack prices and batch documentation.', eligible: true },
  '/about': { title: 'About Biomod and TryBiomod', description: 'TryBiomod.com is the online storefront for Biomod Research Supply Company, a U.S. Marine Corps veteran-owned company with Las Vegas retail roots.', eligible: true },
  '/locations': { title: 'BIOMOD Locations', description: 'BIOMOD stores in Las Vegas, Nevada, the St. George area in Utah, and El Paso, Texas. Contact the team to confirm visiting details.', eligible: false },
  '/contact': { title: 'Contact BIOMOD', description: 'Contact BIOMOD about product documentation, location details, existing orders and general questions.', eligible: true },
  '/testing': { title: 'Batch Documents and Certificates', description: 'Search BIOMOD product lots and original certificates. Matching lots, mismatches and missing documentation are identified separately.', eligible: true },
  '/quality-standard': { title: 'Reading a COA: Lot, Purity, Assay', description: 'Learn how to match a research compound COA to its product lot, distinguish purity from measured content, and read the laboratory’s methods and limitations.', eligible: true },
  '/choosing-a-research-supplier': { title: 'Choosing a Research Compound Supplier', description: 'Check product identity, supplied lots, original COA results and missing handling documents. Compare research compound pack contents and total order costs.', eligible: true },
  '/research-use-only': { title: 'Research Use Policy', description: 'BIOMOD products are supplied for laboratory research. Review purchasing restrictions and the policy on dosing and medical advice.', eligible: true },
  '/news': { title: 'News and Press Releases', description: 'Press releases and announcements from Biomod Research Supply Company and TryBiomod.com, the online store for research compound vials and batch records.', eligible: true },
  '/faq': { title: 'How to Buy Research Compounds', description: 'How to buy research compounds from Biomod, plus answers about COAs, lot matching, purity versus measured content, pack sizes and U.S. shipping.', eligible: true },
  '/shipping-policy': { title: 'Shipping Policy', description: 'BIOMOD U.S. shipping information, processing times and delivery support.', eligible: true },
  '/returns-refunds': { title: 'Returns and Refunds', description: 'How to contact BIOMOD about damaged, incorrect or missing items and request an order review.', eligible: true },
  '/terms-of-sale': { title: 'Terms of Sale', description: 'BIOMOD research purchasing terms, payment verification, order eligibility and policy references.', eligible: false },
  '/privacy-policy': { title: 'Privacy Policy', description: 'How this BIOMOD storefront handles customer information, shopping sessions and privacy requests.', eligible: false },
  '/multi-pack': { title: 'Build and Save a Pack', description: 'Choose a 1, 3, 5 or 10-product BIOMOD pack. Save a selection and review current prices before adding it to your cart.', eligible: false },
  '/presales': { title: 'Presales', description: 'Current BIOMOD presale availability and release information.', eligible: false },
  '/international-partners': { title: 'Partnership Enquiries', description: 'Contact BIOMOD about research supply requirements and partnership enquiries.', eligible: false },
  // Press releases are ordinary public pages: routed, indexed and listed like the guides.
  ...Object.fromEntries(pressReleases.map(release => ['/news/' + release.slug, { title: release.headline, description: release.summary, eligible: true }])),
};
export const productReviewBlocks: Record<string, string> = {
  ...specificationReviews,
  ...Object.fromEntries(products.filter(p => /heat/i.test(p.slug)).map(p => [p.slug, 'Public compound identity must be disclosed accurately before organic product promotion.'])),
  'softgel-methylene-blue-usp': 'Package image states dietary supplement and cognitive support; classification and marketing must be reconciled with the research-only site policy.',
  'softgel-lumen-ghk-cu-ahk-cu-astaxanthin-vitamin-e': 'Astaxanthin specification conflict requires resolution.',
  'noctis-blend-spray': '110 mg / 111 mg container specification conflict requires resolution.',
  'zenith-semax-selank-spray': '100 mg / 20 mg source specification conflict requires resolution.',
};
type Env = Record<string, string | undefined>;
export function seoConfig(env: Env = {}) {
  let publicOrigin = '';
  try {
    const url = new URL(env.SEO_PUBLIC_ORIGIN || '');
    if (url.protocol === 'https:' && ['trybiomod.com', 'biomodpeptides.com', 'www.biomodpeptides.com'].includes(url.hostname)
      && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash) publicOrigin = url.origin;
  } catch { /* An absent or invalid public origin keeps indexing disabled. */ }
  const launchApproved = env.SEO_PUBLIC_LAUNCH_APPROVED === 'true';
  const enabled = env.SEO_INDEXING_ENABLED === 'true' && launchApproved && Boolean(publicOrigin);
  const approvedProducts = new Set((env.SEO_REVIEWED_PRODUCT_SLUGS || '').split(',').map(s => s.trim()).filter(s => products.some(p => p.slug === s) && !productReviewBlocks[s]));
  return { enabled, publicOrigin, origin: enabled ? publicOrigin : previewOrigin, launchApproved, approvedProducts };
}
export type SEOConfig = ReturnType<typeof seoConfig>;
export const privatePath = (path: string) => /^\/(?:account|admin|api|auth|cart|checkout|login|register|forgot-password|reset-password|payment)(?:\/|$)/.test(path);
// Robots blocks admin and non-page paths only; private store pages stay crawlable so their noindex is read.
export const crawlBlockedPaths = ['/admin', '/api/', '/auth/', '/payment/'];
export function normalizedPath(path: string) { return path === '/' ? '/' : '/' + path.replace(/^\/+|\/+$/g, ''); }
export function productAt(path: string): Product | undefined { return path.startsWith('/product/') ? products.find(p => p.slug === path.slice(9)) : undefined; }
export function canonicalPath(path: string) {
  path = normalizedPath(path);
  if (path === '/about-biomod') return '/about';
  if (path === '/coa' || path.startsWith('/testing/')) return '/testing';
  return path;
}
export function pageInfo(path: string) {
  path = canonicalPath(path);
  if (path === '/admin/login') return { title: 'Administrator Sign In', description: 'Sign in to TryBiomod store administration.', eligible: false };
  if (path === '/admin') return { title: 'TryBiomod Administration', description: 'Secure administrator access to the shared TryBiomod store.', eligible: false };
  const p = productAt(path);
  if (p) {
    const contents = size(p).replace(/\s*\/\s*vial/i, '');
    const strength = contents && !p.name.toLowerCase().includes(contents.toLowerCase()) ? ' ' + contents : '';
    const name = `${p.name}${strength} ${productFormat(p) === 'Vial' ? 'Research Vial' : productFormat(p)}`;
    // Keep "Buy <product> Research Vial | <brand>" within a 70-character result line;
    // a long product name drops the word Research from the title only.
    const title = ('Buy ' + name + ' | Biomod Research Supply Company').length > 70 ? `Buy ${p.name}${strength} ${productFormat(p)}` : 'Buy ' + name;
    if (p.slug === 'bpc-157-10mg') return { title: 'Buy BPC-157 10mg Vials', name,
      description: 'BPC-157 (BPC157) 10 mg single-compound vials from BIOMOD. Compare packs, current pricing, batch records and the Wolverine blend. Research use only.', eligible: !productReviewBlocks[p.slug] };
    return { title, name, description: `Buy ${p.name}${strength} (${compound(p)}): single vials or 3, 5 and 10-packs, batch records and U.S. shipping. For laboratory research only.`, eligible: !productReviewBlocks[p.slug] };
  }
  return pageRecords[path] || { title: privatePath(path) ? 'Customer Services' : 'Page Not Found', description: 'BIOMOD customer services and research products.', eligible: false };
}
export function mayIndex(path: string, query: URLSearchParams, config: SEOConfig) {
  path = normalizedPath(path);
  if (!config.enabled || privatePath(path) || [...query.keys()].some(key => !/^(utm_[a-z_]+|gclid|fbclid|msclkid)$/.test(key)) || path !== canonicalPath(path)) return false;
  const p = productAt(path);
  if (p) return !productReviewBlocks[p.slug] && config.approvedProducts.has(p.slug);
  return Boolean(pageRecords[path]?.eligible);
}
// Search engines should see one host. Public GET/HEAD pages on www or plain http move
// permanently to the canonical https origin. Private paths, API calls and other methods are
// left alone so sessions, webhooks and payment returns keep their original host.
export function canonicalRedirect(url: URL, method: string, config: SEOConfig): string | null {
  if (!config.enabled || !['GET', 'HEAD'].includes(method.toUpperCase())) return null;
  const canonical = new URL(config.publicOrigin);
  if (url.origin === canonical.origin || privatePath(normalizedPath(url.pathname))) return null;
  if (![canonical.hostname, 'www.' + canonical.hostname].includes(url.hostname)) return null;
  return canonical.origin + url.pathname + url.search;
}
// Products whose pages may be indexed: reviewed, approved for this origin and not held.
// Catalog order, which is also the order the shop grid shows them in.
export function indexableProducts(config: SEOConfig) {
  return config.enabled ? products.filter(p => config.approvedProducts.has(p.slug) && !productReviewBlocks[p.slug]) : [];
}
export function sitemapPaths(config: SEOConfig) {
  if (!config.enabled) return [];
  return [...Object.keys(pageRecords).filter(p => pageRecords[p].eligible), ...indexableProducts(config).map(p => '/product/' + p.slug)];
}
export function searchReport(config: SEOConfig) {
  return {
    indexingEnabled: config.enabled,
    canonicalOrigin: config.origin,
    launchApproved: config.launchApproved,
    originConfigured: Boolean(config.publicOrigin),
    reviewedOn,
    sitemapCount: sitemapPaths(config).length,
    productMarkup: 'Reviewed products include factual Product data and live offers when verified. No ratings, medical claims or Merchant feeds are emitted.',
    products: products.map(p => ({ name: p.name, slug: p.slug, eligible: config.approvedProducts.has(p.slug) && !productReviewBlocks[p.slug], reason: productReviewBlocks[p.slug] || (config.approvedProducts.has(p.slug) ? 'Product review recorded; public launch controls still apply.' : 'Product classification, packaging and marketing review not recorded.') })),
  };
}
