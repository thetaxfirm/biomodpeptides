'use client';
import { useState } from 'react';
import { type Product, imagePath } from '@/lib/catalog';
import { productImagery } from '@/lib/product-imagery';
export function ProductGallery({ product }: { product: Product }) {
  const [studio, setStudio] = useState(false);
  const artwork = productImagery[product.slug];
  return <div className="product-gallery"><div className={'detail-image' + (studio ? ' studio-image' : '')}><img src={studio && artwork ? artwork.src : imagePath(product)} alt={studio && artwork ? artwork.alt : product.image.alt || product.name} width={studio ? artwork?.width : product.image.width} height={studio ? artwork?.height : product.image.height}/></div>{artwork && <><div className="gallery-options" aria-label="Product images"><button aria-pressed={!studio} onClick={() => setStudio(false)}>Original product image</button><button aria-pressed={studio} onClick={() => setStudio(true)}>Studio illustration</button></div>{studio && <p className="gallery-caption">AI studio illustration. Check the original image and specifications for packaging details.</p>}</>}</div>;
}
