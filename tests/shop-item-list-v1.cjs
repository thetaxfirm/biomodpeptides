/* The shop page's structured data lists the product pages search engines may index, as a
 * CollectionPage with an ItemList in catalog order. Held, blocked and unapproved products are
 * never listed, and the list agrees with the sitemap. No network, credentials or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const publication = require('../lib/seo-publication-v1.json');
const { seoConfig, pageInfo, sitemapPaths, indexableProducts, productReviewBlocks } = require('../lib/seo-policy.ts');
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
    if (request === 'next/headers') return { headers: async () => new Map([['host', new URL(origin).host]]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData } = require('../lib/seo.ts');
const heat = /\b(c-heat|heat-r|heat-t)\b/i;

(async () => {
  // The helper and the sitemap agree, and the preview configuration lists nothing.
  const listed = indexableProducts(config);
  assert.equal(listed.length, 17, 'seventeen reviewed product pages');
  assert.deepEqual(listed.map(p => '/product/' + p.slug), sitemapPaths(config).filter(p => p.startsWith('/product/')));
  assert.deepEqual(indexableProducts(seoConfig()), []);
  for (const p of listed) assert(!productReviewBlocks[p.slug] && publication.productSlugs.includes(p.slug), p.slug);
  assert.deepEqual(listed.map(p => p.slug), products.filter(p => listed.includes(p)).map(p => p.slug), 'catalog order');

  // /shop: CollectionPage whose main entity is the ItemList of those product pages.
  const data = await routeStructuredData('/shop', config);
  const page = data['@graph'].find(item => item['@id'] === origin + '/shop#page');
  assert.deepEqual(page['@type'], ['WebPage', 'CollectionPage']);
  assert.deepEqual(page.mainEntity, { '@id': origin + '/shop#products' });
  const list = data['@graph'].find(item => item['@type'] === 'ItemList');
  assert.equal(list['@id'], origin + '/shop#products');
  assert.equal(list.numberOfItems, 17);
  assert.equal(list.itemListElement.length, 17);
  list.itemListElement.forEach((entry, index) => {
    const product = listed[index];
    assert.deepEqual(entry, { '@type': 'ListItem', position: index + 1, name: pageInfo('/product/' + product.slug).name, url: origin + '/product/' + product.slug }, product.slug);
    assert(!heat.test(entry.url) && !heat.test(entry.name), 'HEAT products are held');
  });
  const urls = new Set(list.itemListElement.map(entry => entry.url));
  assert.equal(urls.size, 17, 'no duplicate URLs');
  for (const p of products) if (!listed.includes(p)) assert(!urls.has(origin + '/product/' + p.slug), p.slug + ' is not indexable and must not be listed');
  assert.equal(data['@graph'].filter(item => item['@type'] === 'ItemList').length, 1);

  // Other pages are unchanged: plain WebPage, no list.
  for (const path of ['/', '/faq', '/product/bpc-157-10mg', '/choosing-a-research-supplier']) {
    const other = await routeStructuredData(path, config);
    assert(!other['@graph'].some(item => item['@type'] === 'ItemList'), path);
    assert.equal(other['@graph'].find(item => item['@id'] === origin + path + '#page')?.['@type'], 'WebPage', path);
  }
  assert.equal(await routeStructuredData('/shop', seoConfig()), null, 'preview origin emits nothing');
  console.log('PASS: /shop CollectionPage lists the 17 indexable product pages in catalog order, matching the sitemap, with no held products; other pages unchanged');
})().catch(error => { console.error(error); process.exit(1); });
