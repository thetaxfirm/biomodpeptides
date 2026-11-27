import { ArrowRight } from 'lucide-react';
import { Product, mass, productFormat } from '@/lib/catalog';
import { eligibleDiscovery, productHeading, sizedVial, vialTitle } from '@/lib/product-discovery';
export { sizedVial, vialTitle };
// Published products that are not vials: sprays, softgel bottles and lab supplies. The shop opens on
// the vial list and its category buttons are not links, so without these plain links no indexed page
// outside the softgel and spray collections leads to them.
const formatOrder = ['Spray', 'Softgels', 'Research supply'];
const formatWords: Record<string, string> = { Spray: 'sprays', Softgels: 'softgels', 'Research supply': 'lab supplies' };
export const otherFormatProducts = (products: Product[], current?: Product) => products
  .filter(v => v.id !== current?.id && !v.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(v))
  .sort((a, b) => formatOrder.indexOf(productFormat(a)) - formatOrder.indexOf(productFormat(b)) || a.name.localeCompare(b.name));
export const otherFormatsHeading = (others: Product[]) => {
  const words = formatOrder.filter(f => others.some(v => productFormat(v) === f)).map(f => formatWords[f]);
  return 'Research ' + (words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words[0]);
};
function OtherFormatsList({ others, level }: { others: Product[]; level: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <><Heading id="other-formats-index-heading">{otherFormatsHeading(others)}</Heading><ul aria-labelledby="other-formats-index-heading">{others.map(v => <li key={v.id}><a href={'/product/' + v.slug}>{productHeading(v)}</a></li>)}</ul></>;
}
// The shop page lists the vials in its grid, so it carries only the other formats.
export function OtherFormatsIndex({ products, level = 2 }: { products: Product[]; level?: 2 | 3 }) {
  const others = otherFormatProducts(products);
  if (!others.length) return null;
  return <nav className="research-vial-index" aria-labelledby="other-formats-index-heading"><OtherFormatsList others={others} level={level}/></nav>;
}
// Plain links to every published research vial. Product pages list the rest of the range;
// the guides and FAQ list all of it, so pages search engines already index lead to the vials.
export function ResearchVialIndex({ current, products, level = 3 }: { current?: Product; products: Product[]; level?: 2 | 3 }) {
  const vials = products.filter(v => v.id !== current?.id && v.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(v))
    .sort((a, b) => a.name.localeCompare(b.name) || (mass(a) || 0) - (mass(b) || 0));
  if (!vials.length) return null;
  const others = otherFormatProducts(products, current);
  const Heading = level === 2 ? 'h2' : 'h3';
  return <nav className="research-vial-index" aria-labelledby="research-vial-index-heading"><Heading id="research-vial-index-heading">All research compounds</Heading><ul>{vials.map(v => <li key={v.id}><a href={'/product/' + v.slug}>{sizedVial(v) ? vialTitle(v) : v.name}</a></li>)}</ul>{others.length > 0 && <OtherFormatsList others={others} level={level}/>}<a className="editorial-link" href="/shop">Shop research compounds <ArrowRight size={17}/></a></nav>;
}
