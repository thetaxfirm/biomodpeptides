"use client";
import { useState } from 'react';
import type { Product } from '@/lib/catalog';
import { ProductCard } from './catalog';
const PAGE_SIZE = 16;
export function HomeVials({ products }: { products: Product[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = Math.min(visible, products.length);
  return <><div id="home-vial-grid" className="product-grid home-product-grid">{products.slice(0, shown).map(product => <ProductCard key={product.id} product={product}/>)}</div><div className="home-load-more"><p role="status">Showing {shown} of {products.length} lyophilized peptides</p>{shown < products.length && <button className="button button-dark" aria-controls="home-vial-grid" onClick={() => setVisible(count => Math.min(count + PAGE_SIZE, products.length))}>Load more lyophilized peptides</button>}</div></>;
}
