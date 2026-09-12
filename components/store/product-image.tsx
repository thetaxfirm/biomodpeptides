import { type Product } from '@/lib/catalog';
import { listingImage } from '@/lib/product-imagery';
import measuredFrames from '@/lib/vial-image-frames-v14.json';

type Frame = { source: number[]; bounds: number[] };
const frames: Record<string, Frame> = measuredFrames;

// Keep the source artwork intact. Its visible container is aligned within a
// shared square display frame, independent of the source image's blank margins.
export function ProductImage({ product, alt = product.name, width = 480, height = 480, loading = 'lazy', zoom = false }: {
  product: Product;
  alt?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  zoom?: boolean;
}) {
  const frame = product.categories.some(category => category.slug === 'research-peptides') && frames[product.image.filename];
  if (!frame) return <img src={listingImage(product)} alt={alt} width={width} height={height} loading={loading}/>;
  const [x, y, w, h] = frame.bounds;
  const scale = 760 / h;
  return <svg className="vial-product-image" viewBox={zoom ? '250 40 500 900' : '0 0 1000 1000'} width={width} height={height} preserveAspectRatio="xMidYMid meet" role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={!alt || undefined} data-product-id={product.id}>
    <image href={listingImage(product)} x={500 - (x + w / 2) * scale} y={870 - (y + h) * scale} width={frame.source[0] * scale} height={frame.source[1] * scale}/>
  </svg>;
}
