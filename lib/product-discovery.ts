import type { Product } from './catalog';
import publication from './seo-publication-v1.json';
import { productReviewBlocks } from './seo-policy';

const reviewedSlugs = new Set<string>(publication.productSlugs);

// Publication review controls discovery slots, not catalog membership or purchasing.
export const eligibleDiscovery = (product: Product) => reviewedSlugs.has(product.slug) && !productReviewBlocks[product.slug];

export function orderHomeVials(allProducts: Product[]): Product[] {
  const vials = allProducts.filter(product => product.categories.some(category => category.slug === 'research-compounds'));
  return [...vials.filter(eligibleDiscovery), ...vials.filter(product => !eligibleDiscovery(product))];
}

// Only these documented pairs represent alternate labeled vial sizes. Shared names,
// ingredients, or categories do not establish equivalence between formulations.
const vialSizeFamilies = [
  ['mots-c-10mg', 'mots-c-40mg'],
  ['ss-31-10mg', 'ss-31-50mg'],
  ['wolverine-10mg', 'wolverine-20mg'],
  ['heat-r-20mg', 'heat-r-30mg'],
] as const;
export function otherVialSizes(product: Product, allProducts: Product[]): Product[] {
  const family = vialSizeFamilies.find(slugs => slugs.some(slug => slug === product.slug));
  if (!family) return [];
  const sizes = family.map(slug => allProducts.find(candidate => candidate.slug === slug));
  // Browsing an explicitly documented size pair does not approve either product
  // for organic promotion or purchase. Those checks remain independent.
  return sizes.every((candidate): candidate is Product => candidate !== undefined) ? sizes : [];
}

export function relatedResearchProducts(product: Product, allProducts: Product[], limit = 3): Product[] {
  const candidates = allProducts.filter(candidate => candidate.id !== product.id &&
    candidate.categories[0]?.slug === product.categories[0]?.slug && eligibleDiscovery(candidate));
  const siblings = otherVialSizes(product, allProducts).filter(candidate => candidates.some(item => item.id === candidate.id));
  const remaining = candidates.filter(candidate => !siblings.some(sibling => sibling.id === candidate.id))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  // Distribute catalog links deterministically instead of repeating the first three
  // alphabetic products. This is navigation, not a claim of scientific similarity.
  const following = remaining.findIndex(candidate => candidate.slug.localeCompare(product.slug) > 0);
  const pivot = following < 0 ? 0 : following;
  return [...siblings, ...remaining.slice(pivot), ...remaining.slice(0, pivot)].slice(0, Math.max(0, limit));
}
