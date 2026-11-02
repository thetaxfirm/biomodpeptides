import { ArrowRight } from 'lucide-react';
import { Product, mass } from '@/lib/catalog';
import { eligibleDiscovery, sizedVial, vialTitle } from '@/lib/product-discovery';
export { sizedVial, vialTitle };
// Plain links to every published research vial. Product pages list the rest of the range;
// the guides and FAQ list all of it, so pages search engines already index lead to the vials.
export function ResearchVialIndex({ current, products, level = 3 }: { current?: Product; products: Product[]; level?: 2 | 3 }) {
  const vials = products.filter(v => v.id !== current?.id && v.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(v))
    .sort((a, b) => a.name.localeCompare(b.name) || (mass(a) || 0) - (mass(b) || 0));
  if (!vials.length) return null;
  const Heading = level === 2 ? 'h2' : 'h3';
  return <nav className="research-vial-index" aria-labelledby="research-vial-index-heading"><Heading id="research-vial-index-heading">All research compounds</Heading><ul>{vials.map(v => <li key={v.id}><a href={'/product/' + v.slug}>{sizedVial(v) ? vialTitle(v) : v.name}</a></li>)}</ul><a className="editorial-link" href="/shop">Shop research compounds <ArrowRight size={17}/></a></nav>;
}
