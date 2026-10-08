import { compound, productFormat, type Product } from './catalog';

// Normalize notation, not chemical identity. Numeric strengths are never fuzzy-matched.
export function searchWords(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map(word => ({ vials: 'vial', peptides: 'peptide', compounds: 'compound', softgels: 'softgel', sprays: 'spray', bottles: 'bottle', milligrams: 'mg' }[word] || word));
}
export function productSearchScore(product: Product, query: string): number {
  const wanted = searchWords(query.slice(0, 200));
  if (!wanted.length) return 1;
  const format = productFormat(product);
  const words = searchWords([product.name, compound(product), product.sku, product.casNumber,
    ...product.sizes, format, ...product.categories.map(c => c.name),
    ...(format === 'Vial' ? ['lyophilized freeze dried vial research'] : [])].join(' '));
  const match = (term: string) => words.some(word => word === term || (/^[a-z]{3,}$/.test(term) && word.startsWith(term)));
  if (!wanted.every(match)) return 0;
  const name = searchWords(product.name).join(' '), phrase = wanted.join(' ');
  const identity = searchWords(compound(product)).join(' ');
  return name === phrase ? 100 : name.startsWith(phrase) ? 80 : identity === phrase ? 70 :
    wanted.every(w => searchWords(product.name).includes(w)) ? 60 : 20;
}
