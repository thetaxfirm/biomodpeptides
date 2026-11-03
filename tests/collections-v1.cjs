/* Shop collections: published products grouped by compound type. A collection is indexed only while
 * two or more of its products are published, shows and lists exactly those products, and carries
 * CollectionPage, ItemList and breadcrumb markup. HTML-only render with stubbed SEO dependencies:
 * no network, credentials or data writes. */
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
global.fetch = async () => { throw new Error('Network forbidden in collection tests'); };

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
const { seoConfig, sitemapPaths, mayIndex, pageInfo, productReviewBlocks } = require('../lib/seo-policy.ts');
const { collections, collectionsFor, publishedCollection, publishedProducts } = require('../lib/collections.ts');
const { routeStructuredData } = require('../lib/seo.ts');
const { StoreProvider } = require('../components/store/provider.tsx');
const { CollectionIndex, CollectionPage } = require('../components/store/collections.tsx');
const config = seoConfig(env);
const render = child => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, child));
const productLinks = html => [...new Set([...html.matchAll(/href="\/product\/([^"#?]+)"/g)].map(m => m[1]))];
const disclaimer = 'Biomod does not provide dosing or medical advice.';
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const published = slug => publication.productSlugs.includes(slug) && !productReviewBlocks[slug];

(async () => {
  const sitemap = sitemapPaths(config);
  const live = collections.filter(publishedCollection);
  assert(live.length >= 5, 'at least five collections are public');
  for (const c of collections) {
    const route = '/collections/' + c.slug;
    for (const slug of c.products) assert(products.some(p => p.slug === slug), c.slug + ': ' + slug + ' exists');
    const info = pageInfo(route);
    assert((info.title + ' | Biomod Research Supply Company').length <= 70, c.slug + ' title fits: ' + info.title);
    assert(info.description.length <= 160, c.slug + ' description length');
    // Indexed exactly while two or more of its products are published.
    const isPublic = c.products.filter(published).length >= 2;
    assert.equal(publishedCollection(c), isPublic, c.slug + ' public rule');
    assert.equal(sitemap.includes(route), isPublic, c.slug + ' sitemap membership');
    assert.equal(mayIndex(route, new URLSearchParams(), config), isPublic, c.slug + ' robots');

    const html = render(React.createElement(CollectionPage, { slug: c.slug }));
    assert.equal((html.match(/<h1\b/g) || []).length, 1, c.slug + ': one h1');
    const links = productLinks(html);
    assert(links.every(slug => c.products.includes(slug) && published(slug)), c.slug + ': links only its own published products');
    assert.deepEqual([...links].sort(), publishedProducts(c).sort(), c.slug + ': every published member is shown');
    assert(!/peptide|dos(e|ing)\b|inject|reconstitut/i.test(text(html).replace(disclaimer, '')), c.slug + ': no peptide, dosing or handling wording');
    if (!isPublic) continue;
    assert(html.includes('href="/compounds/'), c.slug + ': links its compound references');

    const data = await routeStructuredData(route, config);
    const page = data['@graph'].find(node => String(node['@id']).endsWith(route + '#page'));
    assert(page['@type'].includes('CollectionPage'), c.slug + ' CollectionPage');
    const list = data['@graph'].find(node => node['@type'] === 'ItemList');
    assert.deepEqual(list.itemListElement.map(item => item.url).sort(), publishedProducts(c).map(slug => config.origin + '/product/' + slug).sort(), c.slug + ' ItemList');
    assert.equal(list.numberOfItems, publishedProducts(c).length, c.slug + ' ItemList count');
    const crumbs = data['@graph'].find(node => node['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map(item => item.item), [config.origin + '/shop', config.origin + '/collections', config.origin + route]);
  }

  const index = render(React.createElement(CollectionIndex));
  assert.equal((index.match(/<h1\b/g) || []).length, 1);
  for (const c of collections) assert.equal(index.includes('href="/collections/' + c.slug + '"'), publishedCollection(c), 'index lists ' + c.slug + ' only while public');
  assert(sitemap.includes('/collections') && mayIndex('/collections', new URLSearchParams(), config), '/collections indexed');
  assert(productLinks(index).every(published), 'index links only published products');

  // Product pages lead to their collections; held products lead nowhere.
  assert.deepEqual(collectionsFor('nad-500mg').map(c => c.slug), ['mitochondrial-research', 'coenzymes-antioxidants']);
  assert.deepEqual(collectionsFor('tb500-10mg'), []);
  assert(fs.readFileSync(path.join(root, 'components/store/product-research-details.tsx'), 'utf8').includes("'/collections/' + c.slug"));
  assert(fs.readFileSync(path.join(root, 'components/store/content.tsx'), 'utf8').includes('href="/collections"'));
  console.log(`PASS: ${live.length} of ${collections.length} collections public (two or more published products), in the sitemap with CollectionPage, ItemList and breadcrumbs; pages render one h1, link only published members and carry no peptide or dosing wording`);
})().catch(error => { console.error(error); process.exit(1); });
