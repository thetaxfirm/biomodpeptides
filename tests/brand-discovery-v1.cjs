/* Exercise real metadata/JSON-LD functions with isolated configuration and catalog data.
 * Runtime bindings, request headers, and public catalog reads are mocked; no network or DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const { seoConfig, pageInfo, productReviewBlocks } = require('../lib/seo-policy.ts');
const { certificateProperties } = require('../lib/certificate-schema.ts');
const origin = 'https://trybiomod.com';
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: 'bpc-157-10mg,heat-r-20mg,softgel-methylene-blue-usp' };
const live = seoConfig(env);
const bpc = products.find(product => product.slug === 'bpc-157-10mg');
assert(bpc, 'Existing catalog product fixture');
const documentProperties = certificateProperties(bpc.id);
assert(documentProperties.length > 0, 'BPC fixture has matched certificate properties');
let catalogReads = 0;
const originalLoad = Module._load;
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network is forbidden in this test'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/merchant-policies.ts') && request === './commerce') return { config: async () => ({ freeShippingAt: 20000 }) };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => { catalogReads++; return { verified: true, products: [{ ...bpc, price: 12345, inStock: true, purchasable: true }] }; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeMetadata, routeStructuredData } = require('../lib/seo.ts');
const aliases = ['TryBiomod', 'BIOMOD'];
(async () => {
  for (const path of ['/', '/about', '/shop', '/quality-standard', '/product/bpc-157-10mg']) {
    const metadata = routeMetadata(path);
    assert.equal(metadata.alternates.canonical, origin + path, path + ': canonical origin/path retained');
    assert.equal(metadata.robots.index, true, path + ': eligible indexing retained');
    assert.equal(metadata.openGraph.siteName, 'Biomod Peptides');
    const title = path === '/' ? 'Biomod Peptides | Research Vials & COAs | TryBiomod' : pageInfo(path).title + ' | Biomod Peptides';
    assert.deepEqual(metadata.title, { absolute: title });
    assert.equal(metadata.openGraph.title, title);
    assert.equal(metadata.twitter.title, title);
    const data = await routeStructuredData(path);
    assert.equal(data['@context'], 'https://schema.org');
    const graph = data['@graph'];
    const organizations = graph.filter(node => node['@type'] === 'Organization');
    const websites = graph.filter(node => node['@type'] === 'WebSite');
    assert.equal(organizations.length, 1, path + ': one organization');
    assert.equal(websites.length, 1, path + ': one website');
    const [organization] = organizations, [website] = websites;
    for (const entity of [organization, website]) {
      assert.equal(entity.name, 'Biomod Peptides');
      assert.deepEqual(entity.alternateName, aliases);
      assert.equal(entity.url, origin);
    }
    assert.equal(organization['@id'], origin + '/#organization');
    assert.equal(website['@id'], origin + '/#website');
    assert.deepEqual(website.publisher, { '@id': organization['@id'] });
    const page = graph.find(node => node['@type'] === 'WebPage');
    assert.equal(page['@id'], origin + path + '#page');
    assert.deepEqual(page.isPartOf, { '@id': website['@id'] });
    if (path.startsWith('/product/')) {
      const product = graph.find(node => node['@type'] === 'Product');
      assert.equal(product['@id'], origin + path + '#product');
      assert.equal(product.offers.price, '123.45', 'Verified catalog offer stays connected');
      assert.deepEqual(product.offers.seller, { '@id': organization['@id'] });
      for (const property of documentProperties) assert(product.additionalProperty.some(actual => JSON.stringify(actual) === JSON.stringify(property)), 'Matched certificate property retained: ' + property.name);
    }
  }
  assert.equal(pageInfo('/about').title, 'About Biomod Peptides and TryBiomod');
  assert.equal(routeMetadata('/about-biomod').alternates.canonical, origin + '/about', 'Existing alias canonical retained');
  assert.equal(catalogReads, 1, 'Only the eligible product requested a public catalog snapshot');
  const suppressed = ['/account', '/checkout', '/admin', '/about-biomod', '/product/does-not-exist', ...Object.keys(productReviewBlocks).map(slug => '/product/' + slug)];
  for (const path of suppressed) {
    assert.equal(await routeStructuredData(path, live), null, path + ': no held/private/unknown/alias graph');
    assert.equal(routeMetadata(path, new URLSearchParams(), live).robots.index, false);
  }
  const preview = seoConfig();
  for (const path of ['/', '/about', '/product/bpc-157-10mg']) {
    assert.equal(await routeStructuredData(path, preview), null, path + ': no preview graph');
    assert.equal(routeMetadata(path, new URLSearchParams(), preview).robots.index, false);
  }
  assert.equal(catalogReads, 1, 'Suppressed routes do not read offers');
  console.log('PASS: brand metadata, aliases, stable canonical/entity IDs, single organization/site graphs, verified offers, matched certificate properties, and held/private/preview suppression');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
