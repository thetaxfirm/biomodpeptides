'use client';
import { useState } from 'react';
import { Expand } from 'lucide-react';
import { type Product } from '@/lib/catalog';
import { hasBottleImage, listingImage, packagingImage, productImagery } from '@/lib/product-imagery';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function ProductGallery({ product }: { product: Product }) {
  const [selected, setSelected] = useState('packaging');
  const [expanded, setExpanded] = useState(false);
  const artwork = productImagery[product.slug];
  const softgel = hasBottleImage(product);
  const images = [
    { id: 'packaging', label: softgel ? 'Bottle and box' : 'Product image', src: packagingImage(product), alt: softgel ? product.name + ' original bottle and box packaging' : product.image.alt || product.name, ai: false },
    ...(softgel ? [{ id: 'bottle', label: 'Bottle only', src: listingImage(product), alt: 'AI product illustration of the ' + product.name + ' bottle', ai: true }] : []),
    ...(artwork ? [{ id: 'studio', label: 'Studio image', src: artwork.src, alt: artwork.alt, ai: true }] : []),
  ];
  const current = images.find(image => image.id === selected) || images[0];
  return <div className="product-gallery">
    <button className={'detail-image gallery-enlarge' + (current.id === 'studio' ? ' studio-image' : '')} onClick={() => setExpanded(true)} aria-label={'Enlarge ' + product.name + ' ' + current.label.toLowerCase()}><img src={current.src} alt={current.alt} width={softgel && current.id === 'packaging' ? 1600 : 1448} height={softgel && current.id === 'packaging' ? 1067 : 1448}/><span><Expand size={16}/> View larger</span></button>
    {images.length > 1 && <div className="gallery-options" aria-label="Product images">{images.map(image => <button key={image.id} aria-pressed={current.id === image.id} onClick={() => setSelected(image.id)}>{image.label}</button>)}</div>}
    {current.ai && <p className="gallery-caption">AI product illustration. See the original packaging image for label details.</p>}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="product-image-dialog"><DialogTitle>{product.name} · {current.label}</DialogTitle><DialogDescription>{current.ai ? 'AI illustration based on BIOMOD packaging.' : 'Original BIOMOD product image.'}</DialogDescription><img src={current.src} alt={current.alt}/></DialogContent></Dialog>
  </div>;
}
