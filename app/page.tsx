import { FAQ } from '@/components/store/content';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { ProductCard } from '@/components/store/catalog';
import { products } from '@/lib/catalog';
import { productImagery } from '@/lib/product-imagery';
import { routeMetadata, requestSEO, routeStructuredData, jsonLd } from '@/lib/seo';
const collections = [
  {name:'Peptides',slug:'research-peptides',product:'bpc-157-10mg',description:'Single compounds and research blends.'},
  {name:'Softgels',slug:'softgels',product:'softgel-methylene-blue-usp',description:'Capsule formulations in full bottles.'},
  {name:'Sprays',slug:'spray-products',product:'forge-bpc-157-spray',description:'Single-compound and blended solutions.'},
];
export const dynamic = 'force-dynamic';
type Props = { searchParams: Promise<Record<string, string | string[]>> };
const queryParams = (query: Record<string, string | string[]>) => new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => [key, v])));
export async function generateMetadata({searchParams}: Props){return routeMetadata('/',queryParams(await searchParams),await requestSEO());}
export default async function Home({searchParams}: Props){const data=queryParams(await searchParams).size?null:routeStructuredData('/',await requestSEO());return <main id="main-content">{data&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(data)}}/>}
  <section className="campaign-hero">
    <img className="campaign-image" src="/brand/biomod-campaign-v1.png" alt="AI studio illustration of Biomod AZURE, BPC-157 and FORGE product packaging" width={1672} height={941} fetchPriority="high"/>
    <div className="campaign-copy"><h1>Biomod<br/>Peptides.</h1><p>Compounds, pack sizes and<br/>original laboratory reports.</p><a className="button button-gold" href="/shop">Explore the collection <ArrowUpRight size={18}/></a></div>
    <div className="campaign-caption"><span>AI STUDIO IMAGE</span><span>Peptides · Softgels · Sprays</span></div>
  </section>
  <div className="brand-principles wrap"><span>U.S. Marine Corps veteran owned</span><span>1, 3, 5 & 10 packs</span><a href="/testing">Open batch documentation <ArrowUpRight size={16}/></a></div>
  <section className="collection-section wrap"><div className="section-intro"><h2>Shop by format</h2></div><div className="collection-grid">{collections.map(c=>{const art=productImagery[c.product];return <a className="collection-tile" href={'/shop?category='+c.slug} key={c.slug}><div className="collection-image"><img src={art.src} alt={art.alt} loading="lazy" width={art.width} height={art.height}/></div><div className="collection-description"><h3>{c.name}</h3><ArrowUpRight size={22}/><p>{c.description}</p></div></a>})}</div><p className="image-credit">AI studio illustrations based on BIOMOD product images.</p></section>
  <section className="selection-section wrap"><div className="section-intro"><h2>Product details</h2><a className="editorial-link" href="/shop">View all products <ArrowRight size={18}/></a></div><div className="product-grid">{['bpc-157-10mg','softgel-methylene-blue-usp','forge-bpc-157-spray'].map(slug=><ProductCard key={slug} product={products.find(p=>p.slug===slug)!}/>)}</div></section>
  <section className="documentation-story"><div className="wrap documentation-layout"><div><h2>Check the batch.</h2><p>Find the listed lot, compare it with the certificate and read the original report. Missing documents and lot mismatches are marked in the library.</p><a className="editorial-link" href="/testing">Explore batch records <ArrowUpRight size={20}/></a></div><div className="document-route"><a href="/testing"><div><strong>Find the product</strong><p>Search a compound, product, or lot.</p></div><ArrowUpRight size={19}/></a><a href="/quality-standard"><div><strong>Understand the record</strong><p>Identity, purity, and measured content.</p></div><ArrowUpRight size={19}/></a><a href="/contact?subject=Batch%20documentation"><div><strong>Ask about a batch</strong><p>Contact us about missing or mismatched records.</p></div><ArrowUpRight size={19}/></a></div></div></section>
  <section className="pack-story wrap"><div className="pack-story-title"><h2>Save your pack.</h2><p>Choose 1, 3, 5 or 10 vials or bottles. Save the product list for your next order.</p><a className="button button-dark" href="/multi-pack">Build and save a pack <ArrowUpRight size={18}/></a></div><div className="pack-size-display" aria-label="Available pack sizes">{[1,3,5,10].map(n=><a href={'/multi-pack?size='+n} key={n}><span>{n.toString().padStart(2,'0')}</span><small>{n===1?'One product':'Products per pack'}</small><ArrowUpRight size={18}/></a>)}</div></section>
  <section className="home-faq wrap"><div className="section-intro"><h2>Ordering questions</h2><a className="editorial-link" href="/contact">Ask Biomod <ArrowUpRight size={18}/></a></div><FAQ/></section>
  <div className="research-footer-note wrap">For laboratory research only. Not for human or animal use. Age 21+.</div>
 </main>}
