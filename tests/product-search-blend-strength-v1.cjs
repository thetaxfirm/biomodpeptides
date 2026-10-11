// Real catalog, real matcher and real Experience -> Shop HTML. No live requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, filename) => m._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, filename);
require.extensions['.css'] = m => { m.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
global.fetch = () => { throw new Error('No network allowed in blend search regression tests'); };

const { products, compound } = require('../lib/catalog.ts');
const { productSearchScore } = require('../lib/product-search.ts');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { productReviewBlocks, seoConfig, sitemapPaths } = require('../lib/seo-policy.ts');
const publication = require('../lib/seo-publication-v1.json');
const { Experience } = require('../components/store/experience.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const catalogBefore = JSON.stringify(products);
const holdsBefore = JSON.stringify(productReviewBlocks);
const discoveryBefore = products.filter(eligibleDiscovery).map(p => p.slug);
const config = seoConfig({ SEO_PUBLIC_ORIGIN: publication.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') });
const sitemapBefore = sitemapPaths(config);
const product = slug => { const p = products.find(p => p.slug === slug); assert(p, slug); return p; };
const matches = query => products.filter(p => productSearchScore(p, query) > 0).map(p => p.slug).sort();

// A listed blend total cannot stand in for one component's requested contents.
const corrected = [
  ['SS31 50.00 mg', ['ss-31-50mg']],
  ['SS31 50.1mg', []],
  ['BPC157 10.00mg', ['bpc-157-10mg']],
  ['BPC157 20.0mg', []],
  ['BPC157 10.0mg spray', []],
  ['GSH1500.0mg', ['glutathione-reduced-l-glutathione']],
  ['BPC157 10mg', ['bpc-157-10mg']],
  ['BPC157 20mg', []],
  ['TB500 10mg', ['tb500-10mg']],
  ['CJC1295 No DAC 10mg', ['cjc-1295-no-dac-10mg']],
  ['Ipamorelin 10mg', []],
  ['GHK-Cu 70mg', []],
  ['KPV 80mg', []],
  ['BPC157 140mg spray', []],
  ['PT141 35mg spray', []],
];
for (const [query, expected] of corrected) assert.deepEqual(matches(query), expected, query);

// Broad component searches still expose the existing catalog, including blends.
assert.deepEqual(matches('BPC157'), [
  'bpc-157-10mg', 'forge-bpc-157-spray', 'glow-70mg', 'klow-80mg', 'klow-spray',
  'softgel-bionic-bpc-157-arginate-kpv-vitamin-e', 'wolverine-10mg', 'wolverine-20mg',
]);
for (const slug of ['wolverine-10mg', 'run-gun-10mg']) {
  assert(matches('10mg vial').includes(slug), 'Generic total-size browsing remains available: ' + slug);
  const p = product(slug);
  assert(matches(p.sku + ' 10mg').includes(slug), 'Exact SKU and listed total remain available: ' + slug);
}

const unchanged = [
  ['Wolverine 10mg', 'wolverine-10mg'],
  ['Wolverine 20mg', 'wolverine-20mg'],
  ['Wolverine BPC157 10mg', 'wolverine-10mg'],
  ['Wolverine TB500 20mg', 'wolverine-20mg'],
  ['BPC157 TB500 10mg', 'wolverine-10mg'],
  ['TB-500 + BPC-157 20 mg vial', 'wolverine-20mg'],
  ['Run & Gun 10mg', 'run-gun-10mg'],
  ['Run Gun Ipamorelin 10mg', 'run-gun-10mg'],
  ['Ipamorelin CJC1295 No DAC 10mg', 'run-gun-10mg'],
  ['GHK-Cu BPC157 KPV 140mg spray', 'klow-spray'],
  ['BPC157 GHK-Cu TB500 70mg', 'glow-70mg'],
  ['BPC157 GHK-Cu TB500 KPV 80mg', 'klow-80mg'],
  ['PT141 Oxytocin 35mg spray', 'ignite-pt-141-oxytocin-spray'],
  ['MIC Blend Methylcobalamin 10ml', 'lipo-c-w-b12'],
  ['NAD500mg', 'nad-500mg'],
  ['Nicotinamide Adenine Dinucleotide 500mg', 'nad-500mg'],
  ['NAD1000mg spray', 'flux-nad-spray'],
  ['BPC157 50mg spray', 'forge-bpc-157-spray'],
  ['BPC157 10mg peptide', 'bpc-157-10mg'],
  ['SS31 50mg peptide', 'ss-31-50mg'],
  ['MOTS C 40mg peptide', 'mots-c-40mg'],
  ['EPITHALON 50mg peptide', 'epitalon-50mg'],
];
for (const [query, expected] of unchanged) assert.deepEqual(matches(query), [expected], query);

// Partial names, missing identity qualifiers and component splits do not establish
// a complete blend identity or a per-component amount. No arithmetic is inferred.
for (const query of [
  'Wolv BPC157 10mg', 'Run Ipamorelin 10mg', 'Gun CJC1295 10mg',
  'Ipamorelin CJC1295 10mg', 'Ipamorelin CJC1295 No 10mg',
  'BPC157 TB 10mg', 'PT Oxytocin 35mg spray',
  'BPC157 5mg TB500 5mg', 'BPC157 10mg TB500 10mg 20mg',
  'BPC157 TB500 10mg spray', 'BPC157 TB500 10mg softgel',
  'Wolverine 10ml', 'BPC157 10mg spray', 'SS31 21mg',
]) assert.deepEqual(matches(query), [], query);

// Apply the rule to every actual sized blend without manufacturing a component
// split, while retaining explicit whole-identity searches and generic size lookups.
for (const p of products.filter(p => /\s\+\s/.test(compound(p)))) {
  const size = p.sizes.find(value => /\d\s*(mg|mcg|g|ml)\b/.test(value));
  if (!size) continue;
  assert(productSearchScore(p, p.name + ' ' + size) > 0, 'Named blend: ' + p.slug);
  assert(productSearchScore(p, compound(p) + ' ' + size) > 0, 'Complete blend: ' + p.slug);
  assert(productSearchScore(p, size) > 0, 'Generic listed size: ' + p.slug);
  for (const component of compound(p).split(/\s+\+\s+/)) {
    assert.equal(productSearchScore(p, component + ' ' + size), 0, 'No single component borrows total: ' + p.slug + ', ' + component);
    assert(productSearchScore(p, component) > 0, 'Unqualified component search stays broad: ' + p.slug);
  }
}

function shopResults(query) {
  const html = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products },
    React.createElement(Experience, { path: 'shop', query: { q: query } })));
  // Use primary cards only; alternate-size navigation is not another search hit.
  return [...html.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g)]
    .map(match => {
      const primary = match[1].match(/<a class="product-image"[^>]*href="\/product\/([^"]+)"/);
      assert(primary, 'Each product card has a primary product link');
      return primary[1];
    }).sort();
}
for (const [query, expected] of [...corrected, ...unchanged.map(([query, slug]) => [query, [slug]])]) {
  assert.deepEqual(shopResults(query), expected, 'Actual Shop SSR: ' + query);
}
assert.deepEqual(shopResults('BPC157'), matches('BPC157'), 'Broad search remains broad in rendered Shop');
assert.deepEqual(shopResults('10mg vial'), matches('10mg vial'), 'Generic listed-size search remains available in rendered Shop');

assert.equal(JSON.stringify(products), catalogBefore, 'No catalog, stock, price, size or identity mutation');
assert.equal(JSON.stringify(productReviewBlocks), holdsBefore, 'No publication hold mutation');
assert.deepEqual(products.filter(eligibleDiscovery).map(p => p.slug), discoveryBefore, 'No new eligible products');
assert.deepEqual(sitemapPaths(config), sitemapBefore, 'No sitemap publication changes');
assert.equal(sitemapBefore.filter(value => value.startsWith('/product/')).length, 17);
for (const p of products.filter(p => !eligibleDiscovery(p))) {
  assert.equal(productSearchScore(p, p.name + ' peptide'), 0, 'No new reviewed-peptide context for held product: ' + p.slug);
}
console.log('PASS: actual-catalog blend totals never become single-component strengths; named/full blends, broad searches, exact forms, molecular digits, NAD+, aliases and holds preserved; actual Shop SSR confirmed without network calls.');
