// Exercise the real matcher against the actual catalog and publication controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products, productFormat } = require('../lib/catalog.ts');
const { productSearchScore } = require('../lib/product-search.ts');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { productReviewBlocks, seoConfig, sitemapPaths } = require('../lib/seo-policy.ts');
const publication = require('../lib/seo-publication-v1.json');
const catalogBefore = JSON.stringify(products);
const product = slug => { const result = products.find(p => p.slug === slug); assert(result, slug); return result; };
const matches = query => products.filter(p => productSearchScore(p, query) > 0).map(p => p.slug).sort();
const expected = [
  'aod-9604-10mg', 'bpc-157-10mg', 'dsip-10mg', 'epitalon-50mg',
  'glutathione-reduced-l-glutathione', 'kisspeptin-10mg', 'kpv-10mg',
  'mots-c-10mg', 'mots-c-40mg', 'pt-141-10mg', 'selank', 'semax',
  'ss-31-10mg', 'ss-31-50mg', 'tesamorelin-10mg', 'thymosin-alpha-1-10mg',
].sort();
assert.deepEqual(matches('peptide'), expected);
assert.deepEqual(matches('peptides'), expected);
assert.deepEqual(matches('research peptides'), expected);
assert(expected.every(slug => eligibleDiscovery(product(slug)) && productFormat(product(slug)) === 'Vial'));
for (const [query, slug] of [
  ['BPC157 peptide', 'bpc-157-10mg'], ['bpc-157 10mg peptides', 'bpc-157-10mg'],
  ['SS31 50mg peptide', 'ss-31-50mg'], ['SS31 10 mg peptide', 'ss-31-10mg'],
  ['MOTS C 40mg peptide', 'mots-c-40mg'], ['MOTS-C 10mg peptide', 'mots-c-10mg'],
  ['Elamipretide 50mg peptide vial', 'ss-31-50mg'], ['Glutathione 1500mg peptide', 'glutathione-reduced-l-glutathione'],
  ['epithalon', 'epitalon-50mg'], ['EPITHALON 50mg peptide', 'epitalon-50mg'],
]) assert.deepEqual(matches(query), [slug], query);
for (const query of [
  'BPC157 peptide 20mg', 'BPC157 peptide 5mg', 'SS31 21mg peptide', 'SS31 31mg peptide',
  'SS31 5mg', 'MOTS C 64mg peptide', 'MOTS C 20mg peptide', 'epithalon 10mg peptide',
  'BPC157 10mg peptide 20mg', 'SS31 50ml peptide', 'BPC157 10mg peptide spray',
  'BPC157 10mg peptide softgel', 'BPC157 10mg peptide nasal', 'epithalon softgel',
  'NAD 500mg peptide', 'NAD peptide', 'SLU PP 332 peptide', '5 amino 1mq peptide',
  'ERASER peptide', 'Methylene Blue peptide', 'Lipo C peptide',
]) assert.deepEqual(matches(query), [], query);
// Same-family size checks must not infer dosage from identity numbers or CAS fragments.
for (const slug of expected) {
  const p = product(slug);
  assert.equal(productSearchScore(p, p.name + ' 999mg peptide'), 0, slug);
  assert(productSearchScore(p, p.name + ' ' + p.sizes[0] + ' research vial peptide') > 0, slug);
}
// Existing exact identifiers and non-peptide searches remain available on their own terms.
for (const [query, slug] of [['NAD 500mg research vial','nad-500mg'],['53-84-9','nad-500mg'],['BM-LYO-017','ss-31-10mg'],['736992-21-5','ss-31-10mg'],['TB-500','tb500-10mg'],['ghk cu 50mg','ghk-cu-50mg'],['Wolverine 10mg','wolverine-10mg']]) {
  assert(matches(query).includes(slug), query);
}
assert(!matches('BPC157 10mg peptide').some(slug => /wolverine|glow|klow|softgel|spray/.test(slug)), 'Do not substitute blends or another form for the reviewed single-compound vial');
assert.equal(productSearchScore({ ...product('bpc-157-10mg'), categories: [{ slug:'spray-products', name:'Nasal & spray products' }] }, 'bpc157 peptide'), 0);
// Additional review vocabulary must disappear immediately if a reviewed product is held.
const epitalon = product('epitalon-50mg');
try {
  productReviewBlocks[epitalon.slug] = 'Isolated test hold';
  assert.equal(productSearchScore(epitalon, 'epitalon peptide'), 0);
  assert.equal(productSearchScore(epitalon, 'epithalon'), 0);
  assert(productSearchScore(epitalon, 'epitalon') > 0, 'Explicit existing identity lookup does not imply organic approval');
} finally { delete productReviewBlocks[epitalon.slug]; }
for (const p of products.filter(p => !eligibleDiscovery(p))) {
  assert.equal(productSearchScore(p, p.name + ' peptide'), 0, 'No new contextual discovery for held/unreviewed ' + p.slug);
}
assert.equal(JSON.stringify(products), catalogBefore, 'Search never mutates product identity, stock, price or availability');
const config = seoConfig({ SEO_PUBLIC_ORIGIN:publication.origin, SEO_PUBLIC_LAUNCH_APPROVED:'true', SEO_INDEXING_ENABLED:'true', SEO_REVIEWED_PRODUCT_SLUGS:publication.productSlugs.join(',') });
assert.equal(sitemapPaths(config).filter(path => path.startsWith('/product/')).length, 17, 'No publication expansion');
console.log('PASS: real-catalog contextual peptide search, exact Epithalon alias, original identity/SKU/CAS lookup, explicit strength and form negatives, blend distinction, non-peptide exclusion, publication holds and unchanged catalog/sitemap.');
