import Link from 'next/link';
import { type Product } from '@/lib/catalog';
import { eligibleDiscovery, otherVialSizes } from '@/lib/product-discovery';
import { packContents, packSizes, packUnitLimit } from '@/lib/packs';
import { batchFor, batchPath, batchStatus } from '@/lib/testing';
import styles from './product-research-details.module.css';

// Literature context is deliberately limited to these reviewed molecule/size
// pairs. It does not add specifications or test results to any product or lot.
type ResearchStudy = {
  heading: string;
  identity: string;
  models: string;
  materialLabel?: string;
  focus: string;
  citation: string;
  url: string;
  doi: string;
  materialNote?: string;
};
const studies = {
  epitalon: {
    heading: 'Epitalon research context',
    identity: 'Khavinson and colleagues examined the peptide Epithalon in a 2003 cell-culture study.',
    models: 'Cultured human fetal fibroblasts.',
    focus: 'Telomerase activity, expression of its catalytic subunit, and telomere length.',
    citation: 'Khavinson et al. (2003), Bulletin of Experimental Biology and Medicine',
    url: 'https://pubmed.ncbi.nlm.nih.gov/12937682/',
    doi: '10.1023/a:1025493705728',
    materialNote: 'This cell-culture study was not a clinical trial.',
  },
  dsip: {
    heading: 'DSIP research context',
    identity: 'DSIP is described in research literature as a nine-amino-acid peptide.',
    models: 'Rabbits, with comparisons of synthetic DSIP and related peptides.',
    focus: 'Peptide characterization and comparison of delta and spindle electroencephalogram (EEG) patterns.',
    citation: 'Schoenenberger and Monnier (1977), Proceedings of the National Academy of Sciences',
    url: 'https://pubmed.ncbi.nlm.nih.gov/265572/',
    doi: '10.1073/pnas.74.3.1282',
  },
  glutathione: {
    heading: 'Reduced glutathione research context',
    identity: 'Reduced glutathione (GSH) and oxidized glutathione (GSSG) are distinct forms. Camera and colleagues developed an assay that distinguishes and measures both in the same analysis.',
    materialLabel: 'Study material',
    models: 'Collected human blood-cell samples: peripheral blood mononuclear cells.',
    focus: 'Simultaneous measurement of GSH and GSSG by liquid chromatography coupled with mass spectrometry (LC-MS).',
    citation: 'Camera et al. (2001), Journal of Chromatography B',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11419750/',
    doi: '10.1016/s0378-4347(01)00081-0',
    materialNote: "The paper's analytical method is separate from the method reported on the product certificate.",
  },
  thymosinAlpha1: {
    heading: 'Thymosin Alpha-1 research context',
    identity: 'Goldstein and colleagues described thymosin alpha-1 as a 28-amino-acid peptide in their 1977 sequence study.',
    materialLabel: 'Study material',
    models: 'Peptide material isolated from calf thymus for the authors’ study.',
    focus: 'Isolation and amino-acid sequence analysis.',
    citation: 'Goldstein et al. (1977), Proceedings of the National Academy of Sciences',
    url: 'https://pubmed.ncbi.nlm.nih.gov/265536/',
    doi: '10.1073/pnas.74.2.725',
    materialNote: "The study's calf-thymus source does not establish this product's manufacturing origin.",
  },
  bpc157: {
    heading: 'BPC-157 research context',
    identity: 'BPC-157 is described in research literature as a 15-amino-acid peptide.',
    models: 'Tendon fibroblasts cultured from rat Achilles tendon.',
    focus: 'Growth-hormone-receptor expression and related cell signaling.',
    citation: 'Chang et al. (2014), Molecules',
    url: 'https://pubmed.ncbi.nlm.nih.gov/25415472/',
    doi: '10.3390/molecules191119066',
  },
  mots: {
    heading: 'MOTS-c research context',
    identity: 'MOTS-c is a 16-amino-acid, mitochondrial-derived peptide described by Lee and colleagues in 2015.',
    models: 'Cultured cells and mice.',
    focus: 'Folate and purine metabolism, with a focus on AMPK-related signaling.',
    citation: 'Lee et al. (2015), Cell Metabolism',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4350682/',
    doi: '10.1016/j.cmet.2015.02.009',
  },
  ss31: {
    heading: 'SS-31 research context',
    identity: 'SS-31 is a four-amino-acid peptide. Birk and colleagues examined its interactions with mitochondrial membranes in their 2014 paper.',
    models: 'Artificial lipid membranes and mitochondria isolated from rat kidneys.',
    focus: 'Interaction with cardiolipin, a membrane lipid, alongside electron transfer, oxygen consumption and ATP synthesis.',
    citation: 'Birk et al. (2014), British Journal of Pharmacology',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3976619/',
    doi: '10.1111/bph.12468',
  },
} satisfies Record<string, ResearchStudy>;
const researchBySlug: Partial<Record<string, ResearchStudy>> = {
  'epitalon-50mg': studies.epitalon,
  'dsip-10mg': studies.dsip,
  'glutathione-reduced-l-glutathione': studies.glutathione,
  'thymosin-alpha-1-10mg': studies.thymosinAlpha1,
  'bpc-157-10mg': studies.bpc157,
  'mots-c-10mg': studies.mots,
  'mots-c-40mg': studies.mots,
  'ss-31-10mg': studies.ss31,
  'ss-31-50mg': studies.ss31,
};

export function VialSizeLinks({ product, products }: { product: Product; products: Product[] }) {
  const sizes = otherVialSizes(product, products);
  if (sizes.length < 2) return null;
  return <nav className={styles.sizes} aria-labelledby="other-vial-sizes-heading">
    <div className={styles.sizeLabel}><h2 id="other-vial-sizes-heading">Vial size</h2><span>Contents per vial</span></div>
    <ul className={styles.sizeList}>{sizes.map(size => {
      const current = size.id === product.id;
      const availability = size.availabilityLabel || (!size.purchasable ? 'Unavailable' : !size.inStock ? 'Out of stock' : packUnitLimit(size) < 1 ? 'Unavailable' : 'In stock');
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
  const study = researchBySlug[product.slug];
  const packOptions = packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1);
  const documentation = status === 'matched'
    ? 'A certificate is published with a lot number matching this listing. Confirm the lot supplied with your order and read the original report for its methods and results.'
    : status === 'mismatch'
      ? 'The available certificate identifies a different lot. Its results do not verify the listed product lot. Ask Biomod for the matching document.'
      : 'An original certificate for this listed lot is not available in the published documents yet. Pending documentation is not a completed test result.';
  return <><section className={styles.questions} aria-labelledby="product-questions-heading">
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
  </section>
    {study && <section className={styles.research} aria-labelledby="product-research-heading">
      <h2 id="product-research-heading">{study.heading}</h2>
      <p>{study.identity}</p>
      <dl className={styles.studyFacts}>
        <div><dt>{study.materialLabel || 'Models studied'}</dt><dd>{study.models}</dd></div>
        <div><dt>Study focus</dt><dd>{study.focus}</dd></div>
      </dl>
      <p className={styles.citation}>Read the original study: <a href={study.url}>{study.citation}</a>.<span>DOI: {study.doi}</span></p>
      <p className={styles.studyLimits}>The study describes the authors&apos; materials and experimental setting. It does not verify a BIOMOD batch or establish suitability for human use. {study.materialNote && <>{study.materialNote} </>}<a href={record ? batchPath(record) : '/testing?product=' + product.id}>Review this product&apos;s batch record</a>.</p>
    </section>}
  </>;
}
