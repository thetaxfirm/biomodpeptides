'use client';
import { useState } from 'react';
import { Expand } from 'lucide-react';
import { type Product } from '@/lib/catalog';
import { hasBottleImage, packagingImage, productImagery } from '@/lib/product-imagery';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SoftgelGallery } from './softgel-gallery';
export function ProductGallery({ product }: { product: Product }) {
  const [selected, setSelected] = useState('packaging');
  const [expanded, setExpanded] = useState(false);
  const artwork = productImagery[product.slug];
  if (hasBottleImage(product)) return <SoftgelGallery key={product.id} product={product}/>;
  const images = [
    { id: 'packaging', label: 'Product image', src: packagingImage(product), alt: product.image.alt || product.name },
    ...(artwork ? [{ id: 'studio', label: 'Additional view', src: artwork.src, alt: artwork.alt }] : []),
  ];
  const current = images.find(image => image.id === selected) || images[0];
  return <div className="product-gallery">
    <button className={'detail-image gallery-enlarge' + (current.id === 'studio' ? ' studio-image' : '')} onClick={() => setExpanded(true)} aria-label={'Enlarge ' + product.name + ' ' + current.label.toLowerCase()}><img src={current.src} alt={current.alt} width={1448} height={1448}/><span><Expand size={16}/> View larger</span></button>
    {images.length > 1 && <div className="gallery-options" aria-label="Product images">{images.map(image => <button key={image.id} aria-pressed={current.id === image.id} onClick={() => setSelected(image.id)}>{image.label}</button>)}</div>}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="product-image-dialog"><DialogTitle>{product.name} · {current.label}</DialogTitle><DialogDescription>{'Enlarged view of ' + product.name + '.'}</DialogDescription><img src={current.src} alt={current.alt}/></DialogContent></Dialog>
  </div>;
}
