import { products, compound, size, productFormat, type Product } from './catalog';

import specificationReviews from './product-specification-review-v1.json';

export const previewOrigin = 'https://trybiomod.com';
export const reviewedOn = '2026-10-08';
export const pageRecords: Record<string, { title: string; description: string; eligible: boolean }> = {
  '/': { title: 'Research Peptides & Lyophilized Vials | BIOMOD', description: 'Explore BIOMOD lyophilized research compound vials and batch documentation. For laboratory research only. Not for human or animal use.', eligible: true },
  '/softgels': { title: 'The Original Peptide Softgel™ by BIOMOD', description: 'Explore BIOMOD softgel formulations, enteric design and California manufacturing. Browse full bottles in 1, 3, 5 and 10 packs.', eligible: false },
  '/shop': { title: 'Research Peptides: Compounds, Vial Sizes & Batch Records', description: 'Browse BIOMOD products by compound, format and container size. Compare specifications, pack totals and available batch documentation.', eligible: true },
  '/about': { title: 'BIOMOD | Las Vegas Roots and Our Softgel Story', description: 'A veteran-owned company with Las Vegas research compound retail roots and its own softgel formulations, manufactured in California under cGMP standards.', eligible: true },
  '/locations': { title: 'BIOMOD Locations', description: 'BIOMOD location information for Las Vegas, Nevada, and the St. George area in Utah. Contact the team to confirm visiting details.', eligible: false },
  '/contact': { title: 'Contact BIOMOD', description: 'Contact BIOMOD about product documentation, location details, existing orders and general questions.', eligible: true },
  '/testing': { title: 'Batch Documents and Certificates', description: 'Search BIOMOD product lots and original certificates. Matching lots, mismatches and missing documentation are identified separately.', eligible: true },
  '/quality-standard': { title: 'Reading Laboratory Reports', description: 'Review what laboratory certificates report about identity, purity and measured content, and why the lot number and test scope matter.', eligible: true },
  '/research-use-only': { title: 'Research Use Policy', description: 'BIOMOD products are supplied for laboratory research. Review purchasing restrictions and the policy on dosing and medical advice.', eligible: true },
  '/faq': { title: 'Ordering and Documentation Questions', description: 'Answers to common BIOMOD questions about product documents, research use, shipping and order support.', eligible: true },
  '/shipping-policy': { title: 'Shipping Policy', description: 'BIOMOD U.S. shipping information, processing times and delivery support.', eligible: false },
  '/returns-refunds': { title: 'Returns and Refunds', description: 'How to contact BIOMOD about damaged, incorrect or missing items and request an order review.', eligible: false },
  '/terms-of-sale': { title: 'Terms of Sale', description: 'BIOMOD research purchasing terms, payment verification, order eligibility and policy references.', eligible: false },
  '/privacy-policy': { title: 'Privacy Policy', description: 'How this BIOMOD storefront handles customer information, shopping sessions and privacy requests.', eligible: false },
  '/multi-pack': { title: 'Build and Save a Pack', description: 'Choose a 1, 3, 5 or 10-product BIOMOD pack. Save a selection and review current prices before adding it to your cart.', eligible: false },
  '/presales': { title: 'Presales', description: 'Current BIOMOD presale availability and release information.', eligible: false },
  '/international-partners': { title: 'Partnership Enquiries', description: 'Contact BIOMOD about research supply requirements and partnership enquiries.', eligible: false },
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
  const p = productAt(path);
  if (p) {
    const contents = size(p).replace(/\s*\/\s*vial/i, '');
    const strength = contents && !p.name.toLowerCase().includes(contents.toLowerCase()) ? ' ' + contents : '';
    const title = `${p.name}${strength} ${productFormat(p) === 'Vial' ? 'Research Vial' : productFormat(p)}`;
    return { title, description: `${p.name}${strength}. ${compound(p)}. Compare pack sizes, specifications and batch documentation. For laboratory research only; not for human or animal use.`, eligible: !productReviewBlocks[p.slug] };
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
export function sitemapPaths(config: SEOConfig) {
  if (!config.enabled) return [];
  return [...Object.keys(pageRecords).filter(p => pageRecords[p].eligible), ...products.filter(p => config.approvedProducts.has(p.slug) && !productReviewBlocks[p.slug]).map(p => '/product/' + p.slug)];
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
