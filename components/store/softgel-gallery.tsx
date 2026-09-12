'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Expand, ChevronLeft, ChevronRight } from 'lucide-react';
import { type Product, specificationNote } from '@/lib/catalog';
import { packContents } from '@/lib/packs';
import { packagingImage } from '@/lib/product-imagery';
import { softgelDetails } from '@/lib/softgel-details';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// These viewports focus existing pixels in the original 1600 x 1067 photograph.
// They are gallery zoom positions, not generated or retouched label images.
const views = [
  { id: 'packaging', label: 'Bottle & box', bounds: [0, 0, 1600, 1067] },
  { id: 'bottle', label: 'Bottle front', bounds: [1037, 328, 323, 580] },
  { id: 'front', label: 'Box front', bounds: [760, 335, 288, 561] },
  { id: 'side', label: 'Box detail', bounds: [368, 330, 283, 566] },
  { id: 'ingredients', label: 'Ingredients', bounds: null },
] as const;
type View = typeof views[number];

function PackagingView({ product, view, thumbnail = false }: { product: Product; view: View; thumbnail?: boolean }) {
  const titleId = useId();
  const clipId = useId();
  if (!view.bounds) return <span className="ingredient-thumbnail" aria-hidden="true">Ingredients<br/><small>View details</small></span>;
  return <svg className="packaging-viewport" viewBox={view.bounds.join(' ')} preserveAspectRatio="xMidYMid meet" role={thumbnail ? undefined : 'img'} aria-hidden={thumbnail || undefined} aria-labelledby={thumbnail ? undefined : titleId}>
    {!thumbnail && <title id={titleId}>{`${product.name} · ${view.label}, from the original packaging photograph`}</title>}
    <defs><clipPath id={clipId}><rect x={view.bounds[0]} y={view.bounds[1]} width={view.bounds[2]} height={view.bounds[3]}/></clipPath></defs>
    <image href={packagingImage(product)} width={1600} height={1067} clipPath={`url(#${clipId})`}/>
  </svg>;
}

function Ingredients({ product }: { product: Product }) {
  const details = softgelDetails[product.id];
  const issue = specificationNote(product);
  return <div className="softgel-ingredient-panel">
    <div className="ingredient-panel-heading"><h2>{product.name}</h2><p>Ingredients & contents</p><span>{packContents(product).replace('caps', 'softgels')}</span></div>
    <table><caption>Listed formulation per softgel</caption><thead><tr><th scope="col">Compound</th><th scope="col">Amount</th></tr></thead><tbody>{details.compounds.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.amount}</td></tr>)}</tbody></table>
    <dl><div><dt>Shell</dt><dd>Gelatin</dd></div><div><dt>Liquid fill</dt><dd>{details.fillDocumented ? 'Contains medium-chain triglycerides (MCT oil) and sunflower lecithin.' : 'A complete inactive-ingredient declaration is not available yet.'}</dd></div></dl>
    {issue && <p className="ingredient-specification-note">{issue}</p>}
    <p className="ingredient-artwork-note">The original packaging image predates the gelatin-shell update. This panel lists the updated shell information; it is not a photograph of the printed label.</p>
    <a href={'/contact?subject=' + encodeURIComponent('Current label and ingredients: ' + product.name)}>Request the current full label</a>
  </div>;
}

export function SoftgelGallery({ product }: { product: Product }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const enlargeButton = useRef<HTMLButtonElement>(null);
  const ingredientsButton = useRef<HTMLButtonElement>(null);
  const current = views[index];
  const ingredients = current.id === 'ingredients';
  const move = (direction: number) => setIndex(value => (value + direction + views.length) % views.length);
  return <div className="product-gallery softgel-product-gallery">
    <div className="softgel-gallery-stage">
      {ingredients ? <Ingredients product={product}/> : <button disabled={!ready} ref={enlargeButton} className="softgel-view-enlarge" onClick={() => setExpanded(true)} aria-label={'Enlarge ' + product.name + ' ' + current.label.toLowerCase()}><PackagingView product={product} view={current}/><span><Expand size={16}/> View larger</span></button>}
    </div>
    <div className="softgel-gallery-controls"><button disabled={!ready} aria-label="Previous product view" onClick={() => move(-1)}><ChevronLeft size={19}/></button><p aria-live="polite">{current.label} <span>{index + 1} / {views.length}</span></p><button disabled={!ready} aria-label="Next product view" onClick={() => move(1)}><ChevronRight size={19}/></button></div>
    <div className="softgel-gallery-thumbnails" aria-label="Packaging views and ingredients">{views.map((view, i) => <button disabled={!ready} key={view.id} ref={view.id === 'ingredients' ? ingredientsButton : undefined} onClick={() => setIndex(i)} aria-pressed={index === i} aria-label={'Show ' + view.label.toLowerCase()}><span className="softgel-thumbnail-image"><PackagingView product={product} view={view} thumbnail/></span><span className="softgel-thumbnail-label">{view.label}</span></button>)}</div>
    {!ingredients && <p className="gallery-caption">Views show the original packaging photograph. The shell has since been updated to gelatin; select Ingredients for the current shell information.</p>}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="product-image-dialog softgel-image-dialog" onCloseAutoFocus={event => { event.preventDefault(); (ingredients ? ingredientsButton : enlargeButton).current?.focus(); }}><DialogTitle>{product.name} · {current.label}</DialogTitle><DialogDescription>Detail from the original packaging photograph. For readable formulation information, select Ingredients below.</DialogDescription><div className="expanded-packaging-view"><PackagingView product={product} view={current}/></div><button className="button button-dark" onClick={() => { setIndex(views.findIndex(view => view.id === 'ingredients')); setExpanded(false); }}>View ingredients & contents</button></DialogContent></Dialog>
  </div>;
}
