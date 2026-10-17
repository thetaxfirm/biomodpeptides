"use client";
import { useState } from 'react';
import type { Product } from '@/lib/catalog';
import { eligibleDiscovery, orderHomeVials } from '@/lib/product-discovery';
import { ProductCard } from './catalog';
const PAGE_SIZE = 16;
export function HomeVials({ products }: { products: Product[] }) {
  const vials = orderHomeVials(products);
  const initialCount = vials.filter(eligibleDiscovery).length;
  // Keep every reviewed vial visible as the catalog changes. Only extra browsing
  // is stateful, so a small reviewed group never fills its first page with holds.
  const [extraVisible, setExtraVisible] = useState(0);
  const shown = Math.min(initialCount + extraVisible, vials.length);
  return <><div id="home-vial-grid" className="product-grid home-product-grid">{vials.slice(0, shown).map(product => <ProductCard key={product.id} product={product} showVialSizes/>)}</div><div className="home-load-more"><p role="status">Showing {shown} of {vials.length} lyophilized vials</p>{shown < vials.length && <button className="button button-dark" aria-controls="home-vial-grid" onClick={() => setExtraVisible(count => Math.min(count + PAGE_SIZE, vials.length - initialCount))}>Load more lyophilized vials</button>}</div></>;
}
