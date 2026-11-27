/* Compound reference pages link the collections that hold their products and the other compound
 * references of the same research area, and each research-area collection links the side-by-side
 * page for two of its compounds. Links come from catalog data, go only to indexed pages, and a page
 * with nothing to link shows no empty section. HTML-only render with stubbed SEO dependencies: no
 * network, credentials or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
global.fetch = async () => { throw new Error('Network forbidden in reference cross-link tests'); };

const publication = require('../lib/seo-publication-v1.json');
const env = { SEO_PUBLIC_ORIGIN: publication.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const { products } = require('../lib/catalog.ts');
const snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return { runtime: () => env, setting: async (key, fallback) => fallback,
    all: async () => { throw new Error('Unexpected database read'); }, one: async () => { throw new Error('Unexpected database read'); } };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', new URL(publication.origin).host]]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { seoConfig, sitemapPaths } = require('../lib/seo-policy.ts');
const { compounds, comparisons, publishedCompound, publishedComparison } = require('../lib/compound-reference.ts');
const { collections, publishedCollection, publishedProducts, collectionsForCompound, relatedCompounds, collectionComparisons } = require('../lib/collections.ts');
const { lastmodFor } = require('../lib/sitemap-lastmod.ts');
const { StoreProvider } = require('../components/store/provider.tsx');
const { CompoundPage } = require('../components/store/compound-reference.tsx');
const { CollectionPage } = require('../components/store/collections.tsx');
const render = child => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, child));
const section = (html, id) => (new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>(.*?)</section>`).exec(html) || [])[1] || '';
const links = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() }));
const hrefs = html => links(html).map(link => link.href);
const sitemap = sitemapPaths(seoConfig(env));
const changedOn = '2026-11-27';

const shownCompounds = compounds.filter(publishedCompound), shownCollections = collections.filter(publishedCollection);
assert(shownCompounds.length >= 10 && shownCollections.length >= 4, 'published reference pages and collections exist');
let withAreas = 0, withSiblings = 0;
const inbound = Object.fromEntries(shownCompounds.map(c => ['/compounds/' + c.slug, 0]));
for (const c of shownCompounds) {
  const html = render(React.createElement(CompoundPage, { slug: c.slug })), route = '/compounds/' + c.slug;
  // Collections: exactly the published ones that hold one of this compound's published products.
  const expectedAreas = shownCollections.filter(x => publishedProducts(x).some(slug => c.products.includes(slug)));
  const areas = section(html, 'areas-heading');
  assert.deepEqual(hrefs(areas).sort(), expectedAreas.map(x => '/collections/' + x.slug).sort(), route + ' links exactly its collections');
  assert.deepEqual(collectionsForCompound(c).map(x => x.slug).sort(), expectedAreas.map(x => x.slug).sort());
  for (const link of links(areas)) assert.equal(link.text, collections.find(x => '/collections/' + x.slug === link.href).title, 'collection link text is its title');
  if (expectedAreas.length) { withAreas++; assert(areas.includes(`Where ${c.name} is catalogued`), route + ' heading'); }
  else assert(!html.includes('areas-heading'), route + ' shows no empty collection section');
  // Related references: the other published compounds of its research-area collections, never itself, never a format grouping.
  const siblings = section(html, 'siblings-heading'), expectedSiblings = relatedCompounds(c);
  assert.deepEqual(hrefs(siblings), expectedSiblings.map(x => '/compounds/' + x.slug), route + ' links exactly its related references');
  assert(!hrefs(siblings).includes(route), route + ' does not link itself');
  for (const x of expectedSiblings) {
    assert(publishedCompound(x), x.slug + ' is published');
    assert(expectedAreas.some(a => !a.byFormat && publishedProducts(a).some(slug => x.products.includes(slug))), x.slug + ' shares a research area with ' + c.slug);
    assert(links(siblings).some(link => link.href === '/compounds/' + x.slug && link.text === x.name + ' reference data'), 'link text names the compound');
    inbound['/compounds/' + x.slug]++;
  }
  if (expectedSiblings.length) withSiblings++; else assert(!html.includes('siblings-heading'), route + ' shows no empty related section');
  // Every link the page renders goes to a page in the sitemap.
  for (const href of [...hrefs(areas), ...hrefs(siblings)]) assert(sitemap.includes(href), route + ' links only indexed pages: ' + href);
  if (expectedAreas.length || expectedSiblings.length) assert(lastmodFor(route) >= changedOn, `${route} gained related links on ${changedOn} but is dated ${lastmodFor(route)}`);
}
assert(withAreas >= 10 && withSiblings >= 8, `cross-links cover the reference pages (${withAreas} with collections, ${withSiblings} with related references)`);
// Related links are mutual: a compound that lists another is listed back.
for (const c of shownCompounds) for (const x of relatedCompounds(c)) assert(relatedCompounds(x).some(y => y.slug === c.slug), c.slug + ' and ' + x.slug + ' link each other');

let pairLinks = 0;
for (const c of shownCollections) {
  const html = render(React.createElement(CollectionPage, { slug: c.slug })), route = '/collections/' + c.slug;
  const pairs = section(html, 'pairs-heading'), expected = collectionComparisons(c);
  assert.deepEqual(hrefs(pairs), expected.map(x => '/compare/' + x.slug), route + ' links exactly its comparisons');
  for (const x of expected) {
    assert(publishedComparison(x) && sitemap.includes('/compare/' + x.slug), x.slug + ' is an indexed comparison');
    const inCollection = slug => publishedProducts(c).some(p => compounds.find(k => k.slug === slug).products.includes(p));
    assert(inCollection(x.a) && inCollection(x.b), 'both compounds of ' + x.slug + ' are in ' + c.slug);
  }
  if (c.byFormat) assert.equal(expected.length, 0, 'a format grouping lists no comparison');
  if (expected.length) { pairLinks += expected.length; assert(lastmodFor(route) >= changedOn, `${route} gained a comparison link on ${changedOn} but is dated ${lastmodFor(route)}`); }
  else assert(!html.includes('pairs-heading'), route + ' shows no empty comparison section');
}
assert(pairLinks >= 3, 'collections link their side-by-side pages');
assert(comparisons.length >= pairLinks);
// No added wording breaks the research-use-only rules.
for (const c of shownCompounds) {
  const html = render(React.createElement(CompoundPage, { slug: c.slug }));
  assert(!/peptide|dos(e|age|ing) (of|for)|treat|cure/i.test(section(html, 'areas-heading') + section(html, 'siblings-heading')), c.slug + ' related sections stay factual');
}
console.log(`reference cross-links: ${withAreas} compound pages link collections, ${withSiblings} link related references, ${pairLinks} collection-to-comparison links`);
