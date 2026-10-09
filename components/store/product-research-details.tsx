import Link from 'next/link';
import { type Product } from '@/lib/catalog';
import { eligibleDiscovery, otherVialSizes } from '@/lib/product-discovery';
import { packContents, packSizes, packUnitLimit } from '@/lib/packs';
import { batchFor, batchStatus } from '@/lib/testing';
import styles from './product-research-details.module.css';

export function VialSizeLinks({ product, products }: { product: Product; products: Product[] }) {
  const sizes = otherVialSizes(product, products);
  if (sizes.length < 2) return null;
  return <nav className={styles.sizes} aria-labelledby="other-vial-sizes-heading">
    <div className={styles.sizeLabel}><h2 id="other-vial-sizes-heading">Vial size</h2><span>Contents per vial</span></div>
    <ul className={styles.sizeList}>{sizes.map(size => {
      const current = size.id === product.id;
      const availability = !size.inStock ? 'Out of stock' : !size.purchasable || packUnitLimit(size) < 1 ? 'Unavailable' : 'In stock';
      const label = packContents(size).replace(/(\d)\s*mg\b/gi, '$1 mg');
      return <li key={size.id}>
        <a className={styles.sizeOption} href={'/product/' + size.slug} aria-current={current ? 'page' : undefined}>
          <span className={styles.optionHeading}><strong>{label}</strong>{current && <span aria-hidden="true">✓</span>}</span>
          <span className={styles.availability}>{availability}</span>
        </a>
      </li>;
    })}</ul>
  </nav>;
}

export function ProductResearchDetails({ product }: { product: Product }) {
  if (!eligibleDiscovery(product)) return null;
  const record = batchFor(product.id);
  const status = batchStatus(record);
  const packOptions = packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1);
  const documentation = status === 'matched'
    ? 'A certificate is published with a lot number matching this listing. Confirm the lot supplied with your order and read the original report for its methods and results.'
    : status === 'mismatch'
      ? 'The available certificate identifies a different lot. Its results do not verify the listed product lot. Ask Biomod for the matching document.'
      : 'An original certificate for this listed lot is not available in the published documents yet. Pending documentation is not a completed test result.';
  return <section className={styles.questions} aria-labelledby="product-questions-heading">
    <h2 id="product-questions-heading">Product questions</h2>
    <div className={styles.answers}>
      <article>
        <h3>What is included in a single vial or pack?</h3>
        <p>The listed contents for one {product.name} vial are {packContents(product) || 'not provided'}.{product.sku && <> SKU: {product.sku}.</>}</p>
        <p>Pack sizes of {packOptions} count complete vials. The listed contents apply to each vial. Availability and quantity limits apply.</p>
      </article>
      <article>
        <h3>What documentation is available for this product?</h3>
        <p>{documentation}</p>
        <p><a href={'/testing?product=' + product.id}>Read this product&apos;s batch record</a>. <Link href="/quality-standard#read-the-results">Understand purity and measured content</Link>.</p>
      </article>
    </div>
  </section>;
}
