"use client";
import { useState } from 'react';
import type { Product } from '@/lib/catalog';
import { ProductCard } from './catalog';
export function HomeVials({ products }: { products: Product[] }) {
  const [visible, setVisible] = useState(4);
  const shown = Math.min(visible, products.length);
  return <><div id="home-vial-grid" className="product-grid home-product-grid">{products.slice(0, shown).map(product => <ProductCard key={product.id} product={product}/>)}</div><div className="home-load-more"><p role="status">Showing {shown} of {products.length} lyophilized peptides</p>{shown < products.length && <button className="button button-dark" aria-controls="home-vial-grid" onClick={() => setVisible(count => Math.min(count + 4, products.length))}>Load more lyophilized peptides</button>}</div></>;
}
