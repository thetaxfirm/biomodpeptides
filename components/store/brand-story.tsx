import { ArrowUpRight } from 'lucide-react';
import { type Product } from '@/lib/catalog';

export function TrademarkNote() {
  return <p className="brand-trademarks">The Original Peptide Softgel™ and World’s First Peptide Softgel™ are BIOMOD brand marks.</p>;
}

export function SoftgelCollectionIntro() {
  return <section className="softgel-collection-intro"><div><h2>The Original Peptide Softgel™</h2><p>Our own formulations. California softgel manufacturing. A brand rooted in Las Vegas peptide retail.</p><a className="editorial-link" href="/softgels">Inside BIOMOD softgels <ArrowUpRight size={18}/></a></div><img src="/products/softgel-bionic-bpc-157-arginate-kpv-vitamin-e-bottle-v9.png" alt="BIOMOD BIONIC bottle illustration" width={1254} height={1254}/></section>;
}

export function SoftgelProductStory({ product }: { product: Product }) {
  if (!product.categories.some(category => category.slug === 'softgels')) return null;
  const enteric = [776, 777, 781].includes(product.id);
  return <section className="softgel-product-story"><div><p className="softgel-signature">{enteric ? 'The Original Peptide Softgel™' : 'The BIOMOD softgel collection'}</p><h2>{product.name}, by BIOMOD.</h2></div><div><p>{enteric ? 'Part of our peptide softgel line, with an enteric specification tailored to the formulation.' : 'Part of the BIOMOD softgel collection, with its own formulation and container specification.'} Our softgels are manufactured in California, USA under cGMP standards.</p><a className="editorial-link" href="/softgels">Explore the formulation story <ArrowUpRight size={18}/></a></div></section>;
}

export function HomeOriginStory() {
  return <section className="home-origin wrap"><div><h2>Las Vegas roots.<br/>Our own softgel line.</h2><p>BIOMOD grew around a dedicated peptide storefront in Las Vegas. That physical presence remains part of who we are: a team you can contact, a place you can visit and products bearing our own name.</p><a className="editorial-link" href="/about">The BIOMOD story <ArrowUpRight size={18}/></a></div><div className="origin-facts"><div><strong>Las Vegas, Nevada</strong><p>Our retail base and home to spray manufacturing and research-peptide finishing.</p><a href="/locations">Find BIOMOD locations <ArrowUpRight size={17}/></a></div><div><strong>California, USA</strong><p>Softgel manufacturing under current Good Manufacturing Practice standards.</p><a href="/softgels">Meet our softgel collection <ArrowUpRight size={17}/></a></div></div></section>;
}

export function AboutBrand() {
  return <article className="brand-about"><div className="brand-about-heading"><h1>BIOMOD starts<br/>in Las Vegas.</h1><p>A U.S. Marine Corps veteran-owned company with a dedicated peptide storefront and a softgel line of its own.</p></div><img className="brand-about-photo" src="/brand/quality-v1.webp" alt="BIOMOD Peptides wordmark on glass" width={2000} height={1333}/><div className="brand-about-body"><section><h2>A physical presence.</h2><p>Las Vegas is the home of our peptide retail business. Our storefront gives the BIOMOD name a physical presence alongside our online catalog. Contact our team to arrange a visit or discuss a product.</p><a className="editorial-link" href="/locations">Las Vegas and other locations <ArrowUpRight size={18}/></a></section><section><h2>The Original Peptide Softgel™</h2><p>Our softgel line carries the BIOMOD brand marks The Original Peptide Softgel™ and World’s First Peptide Softgel™. BIONIC, LUMEN and DELTA bring peptide combinations into formulations with specified enteric protection. The wider collection includes other compounds, each with its own composition.</p><p>Our softgels are manufactured in California, USA under cGMP standards. Spray manufacturing and research-peptide finishing take place in Nevada.</p><a className="editorial-link" href="/softgels">Explore BIOMOD softgels <ArrowUpRight size={18}/></a></section><section><h2>Our name. Our responsibility.</h2><p>Product identity, formulation and batch records belong in the same conversation. We publish available laboratory documents and flag missing records or lot mismatches so they can be addressed with our team.</p><a className="editorial-link" href="/testing">Open the batch library <ArrowUpRight size={18}/></a></section></div><TrademarkNote/></article>;
}
