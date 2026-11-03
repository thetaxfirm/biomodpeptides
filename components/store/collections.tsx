'use client';
import { ArrowRight } from 'lucide-react';
import type { Product } from '@/lib/catalog';
import { collections, collectionAt, collectionCompounds, publishedCollection, publishedProducts, type Collection } from '@/lib/collections';
import { publishedCompound } from '@/lib/compound-reference';
import { eligibleDiscovery, vialName } from '@/lib/product-discovery';
import { ProductCard } from './catalog';
import { useStore } from './provider';
import styles from './compound-reference.module.css';

// The collection's published products as the store currently lists them, in collection order.
const listed = (c: Collection, products: Product[]) => publishedProducts(c).map(slug => products.find(p => p.slug === slug)).filter((p): p is Product => Boolean(p && eligibleDiscovery(p)));
const ruo = <p className={styles.ruo}>For laboratory research use only. Not for human or animal use. Biomod does not provide dosing or medical advice.</p>;

export function CollectionIndex() {
  const { store } = useStore();
  return <div className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.crumbs}><a href="/shop">Shop</a><span aria-hidden="true">/</span><span>Collections</span></nav>
    <div className="page-heading"><h1>Shop by research area</h1><p>Biomod research vials grouped by what each compound is, with every product linked to its lab report by lot.</p></div>
    <div className={styles.collections}>{collections.filter(publishedCollection).map(c => <section key={c.slug} aria-labelledby={c.slug + '-heading'}>
      <h2 id={c.slug + '-heading'}><a href={'/collections/' + c.slug}>{c.name}</a></h2>
      <p>{c.intro}</p>
      <ul className={styles.inlineList}>{listed(c, store.products).map(p => <li key={p.id}><a href={'/product/' + p.slug}>{vialName(p)}</a></li>)}</ul>
    </section>)}</div>
    <a className="editorial-link" href="/shop">Browse all research compounds <ArrowRight size={17}/></a>
    {ruo}
  </div>;
}

export function CollectionPage({ slug }: { slug: string }) {
  const { store } = useStore();
  const c = collectionAt(slug)!;
  const items = listed(c, store.products);
  const references = collectionCompounds(c).filter(publishedCompound);
  const others = collections.filter(x => x.slug !== c.slug && publishedCollection(x));
  return <div className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.crumbs}><a href="/shop">Shop</a><span aria-hidden="true">/</span><a href="/collections">Collections</a><span aria-hidden="true">/</span><span>{c.name}</span></nav>
    <div className="page-heading"><h1>{c.title}</h1><p>{c.intro}</p></div>
    {items.length ? <div className="product-grid">{items.map(p => <ProductCard key={p.id} product={p}/>)}</div>
      : <p>These products are being prepared for release. <a href="/shop">Browse all research compounds</a>.</p>}
    {references.length > 0 && <section className={styles.section} aria-labelledby="reference-heading"><h2 id="reference-heading">Reference data</h2>
      <div className={styles.tableWrap}><table className={styles.table}>
        <caption className="sr-only">{c.name} compound identifiers</caption>
        <thead><tr><th scope="col">Compound</th><th scope="col">CAS</th><th scope="col">Formula</th><th scope="col">Molecular weight (g/mol)</th></tr></thead>
        <tbody>{references.map(r => <tr key={r.slug}><th scope="row"><a href={'/compounds/' + r.slug}>{r.name}</a></th><td>{r.cas}</td><td>{r.formula}</td><td>{r.weight}</td></tr>)}</tbody>
      </table></div></section>}
    {others.length > 0 && <section className={styles.section} aria-labelledby="other-heading"><h2 id="other-heading">Other research areas</h2>
      <ul className={styles.plainList}>{others.map(x => <li key={x.slug}><a href={'/collections/' + x.slug}>{x.title}</a></li>)}</ul></section>}
    {ruo}
  </div>;
}
