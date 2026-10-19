/* Product descriptions are built from the product's own published records (identity, contents,
 * SKU, CAS, matching batch record, pack options), shown in the Description tab and repeated in the
 * Product structured data. Isolated settings; no network, credentials, bindings or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const root = path.join(__dirname, '..');
const { products, compound, cas } = require('../lib/catalog.ts');
const { packContents } = require('../lib/packs.ts');
const { batchFor, batchStatus, matchingCertificateFor, reportedResult } = require('../lib/testing.ts');
const { productLabel } = require('../lib/product-questions.ts');
const { productDescription } = require('../lib/product-description.ts');
const { productLastmod, lastmodFor } = require('../lib/sitemap-lastmod.ts');
const publication = require('../lib/seo-publication-v1.json');
const { seoConfig, pageInfo } = require('../lib/seo-policy.ts');
const origin = publication.origin;
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const config = seoConfig(env);
const snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load;
global.fetch = async () => { throw new Error('Network forbidden in search tests'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return {
    runtime: () => env, setting: async (key, fallback) => fallback,
    all: async () => { throw new Error('Unexpected database read'); }, one: async () => { throw new Error('Unexpected database read'); },
  };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData } = require('../lib/seo.ts');
const node = (data, type) => data['@graph'].find(item => item['@type'] === type);
// Official compound names in catalog data may contain the word; store copy may not.
const identities = /Delta Sleep-Inducing Peptide|Epitalon Tetrapeptide|Copper Tripeptide-1/g;
const claims = /\b(dos(e|es|ing|age)|treat(s|ment)?|cure|heal(s|ing)?|benefit(s)?|human use|inject(ion)?|take|administer)\b/i;

(async () => {
  const seen = new Set();
  for (const slug of publication.productSlugs) {
    const product = products.find(p => p.slug === slug);
    const paragraphs = productDescription(product);
    const text = paragraphs.join(' ');
    assert(paragraphs.length >= 2 && paragraphs.length <= 3, slug + ': listing, batch and pack paragraphs');
    assert(!seen.has(text), slug + ': description is unique to this product');
    seen.add(text);

    // Listing paragraph: the searched label, identity, contents, SKU and CAS from the catalog record.
    const listing = paragraphs[0];
    assert(listing.startsWith(productLabel(product) + ' from Biomod Research Supply Company is supplied as a single research vial'), slug + ': ' + listing);
    const contents = packContents(product).replace(/\s*\/\s*vial$/i, '');
    assert(listing.includes(`listed contents of ${contents} per vial`), slug + ': contents ' + contents);
    if (product.sku?.trim()) assert(listing.includes('SKU ' + product.sku.trim()), slug + ': SKU'); else assert(!/SKU/.test(listing), slug + ': no SKU invented');
    if (cas(product)) assert(listing.includes('CAS ' + cas(product)), slug + ': CAS'); else assert(!/CAS/.test(listing), slug + ': no CAS invented');
    if (compound(product) !== product.name) assert(listing.includes('The listed identity is ' + compound(product) + '.'), slug + ': identity');

    // Batch paragraph mirrors the batch record exactly: facts only for a matching lot, otherwise the update notice.
    const batch = paragraphs[1];
    const record = batchFor(product.id, product), status = batchStatus(record), doc = matchingCertificateFor(record);
    if (status === 'matched') {
      assert(doc && record.product_lot, slug + ': matched records carry a lot and certificate');
      assert(batch.includes('covers lot ' + record.product_lot), slug + ': lot ' + batch);
      const purity = reportedResult(doc, 'purity'), assay = reportedResult(doc, 'assay');
      if (purity !== 'Not reported') assert(batch.includes('purity of ' + purity), slug + ': purity ' + batch);
      if (assay !== 'Not reported') assert(batch.includes('measured content of ' + assay), slug + ': measured content ' + batch);
      assert(batch.includes('Match the lot on your vial label'), slug + ': lot matching reminder');
    } else {
      assert(/being updated|Certificate of Analysis/.test(batch), slug + ': no certificate facts without a matching lot: ' + batch);
      assert(!/purity|measured content/i.test(batch), slug + ': no purity or content without a matching lot');
    }

    // Pack paragraph: only the documented 1, 3, 5 and 10 counts.
    assert.equal(paragraphs[2], 'Order a single vial or a 3, 5 or 10-pack; each pack price on this page is shown per vial.', slug);

    // Research-use-only wording: facts about the listing, no dosing, use or effect claims, no "peptide" copy.
    assert(!claims.test(text), slug + ': no dosing, use or effect wording: ' + text);
    assert(!/peptide/i.test(text.replace(identities, '')), slug + ': no peptide wording');
    assert(!/HEAT/.test(text), slug + ': no HEAT names');

    // The Product structured data carries the same facts after the searched phrase.
    const data = await routeStructuredData('/product/' + slug, config);
    assert.equal(node(data, 'Product').description, [pageInfo('/product/' + slug).description, ...productDescription(snapshot.products.find(p => p.id === product.id))].join(' '), slug + ': Product description mirrors the visible description');
  }

  // Known records, checked literally so a data change is noticed.
  const bpc = productDescription(products.find(p => p.slug === 'bpc-157-10mg'));
  assert.equal(bpc[0], 'BPC-157 10mg from Biomod Research Supply Company is supplied as a single research vial with listed contents of 10mg per vial (SKU BM-LYO-010, CAS 137525-51-0). The listed identity is Body Protection Compound.');
  assert.match(bpc[1], /^The batch record published with this product covers lot 201-10-0001\. The laboratory report dated 4\/8\/2026 lists purity of >99\.80% \+ 0\.18% and measured content of 10\.51 mg\. Match the lot/);
  const semax = productDescription(products.find(p => p.slug === 'semax'));
  assert.equal(semax[1], 'The lab report for lot LYO-029-2608-01 is being updated. Contact BIOMOD anytime for the latest documentation.');
  const ss31 = productDescription(products.find(p => p.slug === 'ss-31-50mg'));
  assert(!/SKU|lot [A-Z0-9]/.test(ss31[0] + ss31[1]), 'SS-31 50mg has no SKU or lot on record, so none is shown');

  // The visible Description tab renders these paragraphs, and the product pages are dated for the change.
  const catalog = fs.readFileSync(path.join(root, 'components/store/catalog.tsx'), 'utf8');
  assert(/TabsContent value="description">[^]*?\{productSummary\(p\)\}[^]*?productDescription\(p\)\.map/.test(catalog), 'Description tab renders the record-based paragraphs after the summary');
  assert(productLastmod >= '2026-10-19', 'product pages gained the description paragraphs on 2026-10-19 but are dated ' + productLastmod);
  assert(lastmodFor('/product/bpc-157-10mg') >= '2026-10-19');
  console.log('PASS: product descriptions come from the published records, carry no use or dosing claims, match the Product markup, and the product pages are dated for the change');
})().catch(error => { console.error(error); process.exit(1); });
