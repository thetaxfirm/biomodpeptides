import { FAQ } from '@/components/store/content';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { ProductCard } from '@/components/store/catalog';
import { products, imagePath } from '@/lib/catalog';
const collections = [
  {name:'Peptides',slug:'research-peptides',product:'bpc-157-10mg',description:'Single compounds and research blends.'},
  {name:'Softgels',slug:'softgels',product:'softgel-methylene-blue-usp',description:'Clearly identified capsule formulations.'},
  {name:'Sprays',slug:'spray-products',product:'forge-bpc-157-spray',description:'Single-compound and blended solutions.'},
];
export default function Home(){return <main id="main-content">
  <section className="campaign-hero">
    <img className="campaign-image" src="/brand/biomod-campaign-v1.png" alt="Biomod AZURE softgel bottle, BPC-157 vial, and FORGE spray in a graphite and bronze studio composition" width={1672} height={941} fetchPriority="high"/>
    <div className="campaign-copy"><h1>Research,<br/>in clear view.</h1><p>Know the compound. Choose your format.<br/>See the documentation.</p><a className="button button-gold" href="/shop">Explore the collection <ArrowUpRight size={18}/></a></div>
    <div className="campaign-caption"><span>BIOMOD / RESEARCH COLLECTION</span><span>Peptides · Softgels · Sprays</span></div>
  </section>
  <div className="brand-principles wrap"><span>U.S. Marine Corps veteran owned</span><span>1, 3, 5 & 10 packs</span><a href="/testing">Open batch documentation <ArrowUpRight size={16}/></a></div>
  <section className="collection-section wrap"><div className="section-intro"><h2>Find your format.</h2><p>One collection. Three ways to build your research order.</p></div><div className="collection-grid">{collections.map(c=>{const p=products.find(p=>p.slug===c.product)!;return <a className="collection-tile" href={'/shop?category='+c.slug} key={c.slug}><div className="collection-image"><img src={imagePath(p)} alt={p.name} loading="lazy" width={480} height={480}/></div><div className="collection-description"><h3>{c.name}</h3><ArrowUpRight size={22}/><p>{c.description}</p></div></a>})}</div></section>
  <section className="selection-section wrap"><div className="section-intro"><h2>A closer look.</h2><a className="editorial-link" href="/shop">View all products <ArrowRight size={18}/></a></div><div className="product-grid">{['bpc-157-10mg','softgel-methylene-blue-usp','forge-bpc-157-spray'].map(slug=><ProductCard key={slug} product={products.find(p=>p.slug===slug)!}/>)}</div></section>
  <section className="documentation-story"><div className="wrap documentation-layout"><div><h2>The label is<br/>the beginning.</h2><p>Go further with product identities, published lot numbers, and original laboratory reports. See which certificate matches the listed lot and where documentation is still pending.</p><a className="editorial-link" href="/testing">Explore batch records <ArrowUpRight size={20}/></a></div><div className="document-route"><a href="/testing"><span>01</span><div><strong>Find the product</strong><p>Search a compound, product, or lot.</p></div><ArrowUpRight size={19}/></a><a href="/quality-standard"><span>02</span><div><strong>Understand the record</strong><p>Identity, purity, and measured content.</p></div><ArrowUpRight size={19}/></a><a href="/testing"><span>03</span><div><strong>Read the original</strong><p>Open the laboratory’s certificate.</p></div><ArrowUpRight size={19}/></a></div></div></section>
  <section className="pack-story wrap"><div className="pack-story-title"><h2>Your selection.<br/>Your next order, ready.</h2><p>Mix products across formats. Save a named pack and return to it when you need it.</p><a className="button button-dark" href="/multi-pack">Build and save a pack <ArrowUpRight size={18}/></a></div><div className="pack-size-display" aria-label="Available pack sizes">{[1,3,5,10].map(n=><a href={'/multi-pack?size='+n} key={n}><span>{n.toString().padStart(2,'0')}</span><small>{n===1?'One product':'Products per pack'}</small><ArrowUpRight size={18}/></a>)}</div></section>
  <section className="home-faq wrap"><div className="section-intro"><h2>Before you order.</h2><a className="editorial-link" href="/contact">Ask Biomod <ArrowUpRight size={18}/></a></div><FAQ/></section>
  <div className="research-footer-note wrap">For laboratory research only. Not for human or animal use. Age 21+.</div>
 </main>}
