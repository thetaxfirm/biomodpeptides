import { compound, productFormat, type Product } from './catalog';
import { eligibleDiscovery } from './product-discovery';

// Reviewed peptide identities, not every item in the Research Compounds category.
// This does not release a publication hold or add a product to the catalog.
const peptideVialSlugs = new Set([
  'aod-9604-10mg', 'bpc-157-10mg', 'dsip-10mg', 'epitalon-50mg',
  'glutathione-reduced-l-glutathione', 'kisspeptin-10mg', 'kpv-10mg',
  'mots-c-10mg', 'mots-c-40mg', 'pt-141-10mg', 'selank', 'semax',
  'ss-31-10mg', 'ss-31-50mg', 'tesamorelin-10mg', 'thymosin-alpha-1-10mg',
]);
// Original lab report V260304-6 016, lot 407-50-0001, names Epithalon 50 mg.
// This alias belongs only to that reviewed product, not all compounds or blends.
const productAliases: Readonly<Record<string, readonly string[]>> = {
  'epitalon-50mg': ['epithalon'],
};

// Normalize notation, not chemical identity. Numeric strengths are never fuzzy-matched.
export function searchWords(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map(word => ({ vials: 'vial', peptides: 'peptide', compounds: 'compound', softgels: 'softgel', sprays: 'spray', bottles: 'bottle', milligrams: 'mg' }[word] || word));
}
function quantities(words: string[]) {
  return words.flatMap((unit, index) => index > 0 && /^(mg|mcg|g|ml)$/.test(unit) && /^\d+(?:\.\d+)?$/.test(words[index - 1])
    ? [words[index - 1] + ' ' + unit] : []);
}
export function productSearchScore(product: Product, query: string): number {
  const wanted = searchWords(query.slice(0, 200));
  if (!wanted.length) return 1;
  const format = productFormat(product);
  const reviewedPeptide = format === 'Vial' && peptideVialSlugs.has(product.slug) && eligibleDiscovery(product);
  if (wanted.includes('peptide') && !reviewedPeptide) return 0;
  // A requested 21 mg size must not match the 21 segment in SS-31's CAS number.
  // Keep quantity and unit together and require the listed container size, not a
  // component name, CAS, SKU or the sum of unrelated blend ingredients.
  const listedQuantities = product.sizes.flatMap(value => quantities(searchWords(value)));
  if (quantities(wanted).some(quantity => !listedQuantities.includes(quantity))) return 0;
  const aliases = reviewedPeptide ? productAliases[product.slug] || [] : [];
  const words = searchWords([product.name, compound(product), product.sku, product.casNumber,
    ...product.sizes, format, ...product.categories.map(c => c.name), ...aliases,
    ...(reviewedPeptide ? ['peptide'] : []),
    ...(format === 'Vial' ? ['lyophilized freeze dried vial research'] : [])].join(' '));
  const match = (term: string) => words.some(word => word === term || (/^[a-z]{3,}$/.test(term) && word.startsWith(term)));
  if (!wanted.every(match)) return 0;
  const name = searchWords(product.name).join(' '), phrase = wanted.join(' ');
  const identity = searchWords(compound(product)).join(' ');
  return name === phrase ? 100 : name.startsWith(phrase) ? 80 : identity === phrase ? 70 :
    wanted.every(w => searchWords(product.name).includes(w)) ? 60 : 20;
}
