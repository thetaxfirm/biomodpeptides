import { FAQ } from '@/components/store/content';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { PackOffers } from '@/components/store/catalog';
import { products } from '@/lib/catalog';
import { HomeVials } from '@/components/store/home-vials';
import { routeMetadata, requestSEO, routeStructuredData, jsonLd } from '@/lib/seo';
const homeCollections = [
  { id: 'vials', name: 'Lyophilized vials', category: 'research-compounds', description: 'Freeze-dried compounds for laboratory research.', href: '/shop?category=research-compounds', link: 'View research vials', products: ['bpc-157-10mg', 'tb500-10mg', 'ghk-cu-50mg', 'mots-c-10mg'] },
];
export const dynamic = 'force-dynamic';
type Props = { searchParams: Promise<Record<string, string | string[]>> };
const queryParams = (query: Record<string, string | string[]>) => new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => [key, v])));
export async function generateMetadata({searchParams}: Props){return routeMetadata('/',queryParams(await searchParams),await requestSEO());}
export default async function Home({searchParams}: Props){const data=queryParams(await searchParams).size?null:routeStructuredData('/',await requestSEO());return <main id="main-content">{data&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(data)}}/>}
  <section className="research-campaign">
    <img className="campaign-image" src="/brand/biomod-bpc-157-still-life-v35.webp" alt="BIOMOD BPC-157 research vial" width={1448} height={1086} fetchPriority="high"/>
    <div className="campaign-copy"><h1>Research-only<br/>compound vials.</h1><p>Lyophilized research compounds for laboratory research.<br/>Not for human or animal use.</p><a className="button button-gold" href="/shop?category=research-compounds">Explore research vials <ArrowUpRight size={18}/></a></div>
  </section>
  <div className="brand-principles wrap"><span>U.S. Marine Corps veteran owned</span><span>1, 3, 5 & 10 packs</span><a href="/testing">Open batch documentation <ArrowUpRight size={16}/></a></div>
  {homeCollections.map(collection => <section className="home-product-section wrap" id={'home-' + collection.id} data-category={collection.category} key={collection.id} aria-labelledby={'home-' + collection.id + '-title'}><header className="home-collection-heading"><div><h2 id={'home-' + collection.id + '-title'}>{collection.name}</h2><p>{collection.description}</p></div><a className="editorial-link" href={collection.href}>{collection.link}<ArrowUpRight size={18}/></a></header><PackOffers/><HomeVials products={[...collection.products.map(slug => products.find(p => p.slug === slug)).filter((p): p is NonNullable<typeof p> => !!p), ...products.filter(p => p.categories.some(c => c.slug === collection.category) && !collection.products.includes(p.slug))]}/></section>)}
  <nav className="home-format-navigation wrap secondary-collections" aria-label="Shop by product format"><a href="/softgels">Softgels<ArrowRight size={17}/></a><a href="/shop?category=spray-products">Nasal &amp; spray products<ArrowRight size={17}/></a></nav>
  <section className="documentation-story"><div className="wrap documentation-layout"><div><h2>Check the batch.</h2><p>Find the listed lot, compare it with the certificate and read the original report. Missing documents and lot mismatches are marked in the library.</p><a className="editorial-link" href="/testing">Explore batch records <ArrowUpRight size={20}/></a></div><div className="document-route"><a href="/testing"><div><strong>Find the product</strong><p>Search a compound, product, or lot.</p></div><ArrowUpRight size={19}/></a><a href="/quality-standard"><div><strong>Understand the record</strong><p>Identity, purity, and measured content.</p></div><ArrowUpRight size={19}/></a><a href="/contact?subject=Batch%20documentation"><div><strong>Ask about a batch</strong><p>Contact us about missing or mismatched records.</p></div><ArrowUpRight size={19}/></a></div></div></section>
  <section className="pack-story wrap"><div className="pack-story-title"><h2>Save your pack.</h2><p>Choose 1, 3, 5 or 10 research vials. Save the product list for your next order.</p><a className="button button-dark" href="/multi-pack">Build and save a pack <ArrowUpRight size={18}/></a></div><div className="pack-size-display" aria-label="Available pack sizes">{[1,3,5,10].map(n=><a href={'/multi-pack?size='+n} key={n}><span>{n.toString().padStart(2,'0')}</span><small>{n===1?'One product':'Products per pack'}</small><ArrowUpRight size={18}/></a>)}</div></section>
  <section className="home-faq wrap"><div className="section-intro"><h2>Ordering questions</h2><a className="editorial-link" href="/contact">Ask Biomod <ArrowUpRight size={18}/></a></div><FAQ/></section>
  <div className="research-footer-note wrap">For laboratory research only. Not for human or animal use. Age 21+.</div>
 </main>}
