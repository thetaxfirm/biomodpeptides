/* Real Product structured data over the reviewed catalog with isolated settings.
 * No network, credentials, production bindings, orders or persistent data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const originalTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products, imagePath } = require('../lib/catalog.ts');
const source = require('../lib/catalog-facts-v2.json');
const publication = require('../lib/seo-publication-v1.json');
const { seoConfig, productReviewBlocks } = require('../lib/seo-policy.ts');
const { certificateProperties } = require('../lib/certificate-schema.ts');
const origin = publication.origin;
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const config = seoConfig(env);
const reviewed = publication.productSlugs.map(slug => {
  const product = products.find(item => item.slug === slug);
  assert(product, 'Every publication-listed product has a catalog record');
  return product;
});
assert.equal(reviewed.length, 17, 'The release audit covers all 17 current eligible products');
let snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load, originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden in schema tests'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return {
    setting: async (key, fallback) => { assert.equal(key, 'store'); return { ...fallback, freeShippingAt: 20000 }; },
    all: async () => { throw new Error('Unexpected database read'); },
    one: async () => { throw new Error('Unexpected database read'); },
  };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData, jsonLd } = require('../lib/seo.ts');
const productNode = data => data['@graph'].find(node => node['@type'] === 'Product');
const clone = value => JSON.parse(JSON.stringify(value));
function withoutSku(data) {
  const copy = clone(data);
  delete productNode(copy).sku;
  return copy;
}
function noInventedIdentifiers(node) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    assert.ok(!/^(?:mpn|gtin(?:8|12|13|14)?)$/i.test(key), 'No invented manufacturer or global trade identifier: ' + key);
    noInventedIdentifiers(value);
  }
}
(async () => {
  try {
    let assigned = 0, missing = 0;
    for (const product of reviewed) {
      const path = '/product/' + product.slug;
      const data = await routeStructuredData(path, config);
      const node = productNode(data);
      const original = source.find(item => item.slug === product.slug);
      const live = snapshot.products.find(item => item.id === product.id);
      assert(original && node && live);
      assert.equal(node['@id'], origin + path + '#product', 'Canonical Product identity stays independent of SKU');
      assert.equal(node.url, origin + path);
      assert.equal(node.image, origin + imagePath(product));
      if (original.sku?.trim()) {
        assigned++;
        assert.equal(node.sku, original.sku.trim(), product.slug + ': preserve the merchant-assigned source SKU');
      } else {
        missing++;
        assert.equal(Object.hasOwn(node, 'sku'), false, product.slug + ': optional SKU absent when not assigned');
      }
      assert.deepEqual(node.additionalProperty, [
        { '@type': 'PropertyValue', name: 'Compound', value: product.identity },
        { '@type': 'PropertyValue', name: 'Container contents', value: product.sizes[0] },
        ...(product.casNumber ? [{ '@type': 'PropertyValue', name: 'CAS', value: product.casNumber }] : []),
        ...certificateProperties(product.id),
      ], product.slug + ': compound, contents and matching-lot certificate evidence stay unchanged');
      assert.deepEqual(node.offers, {
        '@type': 'Offer', url: origin + path, priceCurrency: 'USD', price: (live.price / 100).toFixed(2),
        availability: live.inStock && live.purchasable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller: { '@id': origin + '/#organization' },
        hasMerchantReturnPolicy: { '@id': origin + '/returns-refunds#policy' },
        shippingDetails: { '@type': 'OfferShippingDetails', hasShippingService: { '@id': origin + '/shipping-policy#standard-shipping' } },
      }, product.slug + ': verified live Offer and policy references stay unchanged');
      noInventedIdentifiers(data);
      assert.deepEqual(JSON.parse(jsonLd(data)), data, 'Serialized graph preserves omitted identifiers');
    }
    assert.equal(assigned, 16);
    assert.equal(missing, 1);

    const eligiblePreorder = snapshot.products.find(product => product.id === reviewed[0].id);
    eligiblePreorder.activePreorder = { percentOff: 15, ships: 'early November 2026', basePrice: eligiblePreorder.price };
    eligiblePreorder.price = Math.round(eligiblePreorder.price * .85);
    const preorderOffer = productNode(await routeStructuredData('/product/' + eligiblePreorder.slug, config)).offers;
    assert.equal(preorderOffer.availability, 'https://schema.org/PreOrder');
    assert.equal(preorderOffer.price, (eligiblePreorder.price / 100).toFixed(2));
    eligiblePreorder.inStock = false;
    assert.equal(productNode(await routeStructuredData('/product/' + eligiblePreorder.slug, config)).offers.availability, 'https://schema.org/OutOfStock');
    snapshot = { verified: true, products: products.map(product => ({ ...product })) };
    const heldPreorder = products.find(product => product.categories.some(c => c.slug === 'softgels'));
    assert.equal(await routeStructuredData('/product/' + heldPreorder.slug, config), null, 'Preorder cannot enable a publication hold');

    const ss31 = reviewed.find(product => product.slug === 'ss-31-50mg');
    assert(ss31);
    assert.equal(ss31.sku, '', 'Known source does not assign a SKU to SS-31 50mg');
    assert.equal(ss31.id, 5027, 'Internal record ID is deliberately not a merchant SKU');
    const path = '/product/' + ss31.slug;
    const baseline = await routeStructuredData(path, config);
    assert.equal(Object.hasOwn(productNode(baseline), 'sku'), false);
    const originalSku = ss31.sku;
    try {
      for (const empty of ['', ' ', '\t\n  ', undefined, null]) {
        ss31.sku = empty;
        const data = await routeStructuredData(path, config);
        assert.equal(Object.hasOwn(productNode(data), 'sku'), false, 'Blank, whitespace and absent source SKUs are omitted');
        assert.deepEqual(data, baseline, 'Missing SKU never substitutes record ID or alters other evidence');
      }
      // A future source-assigned SKU can be rendered, but only that actual value.
      ss31.sku = '  FIXTURE-ASSIGNED-50  ';
      const assignedData = await routeStructuredData(path, config);
      assert.equal(productNode(assignedData).sku, 'FIXTURE-ASSIGNED-50');
      assert.deepEqual(withoutSku(assignedData), baseline, 'Only the explicitly assigned SKU changes');
    } finally { ss31.sku = originalSku; }

    const baselineProduct = productNode(baseline);
    snapshot = { verified: false, products: snapshot.products };
    const unavailable = productNode(await routeStructuredData(path, config));
    assert.equal(Object.hasOwn(unavailable, 'offers'), false, 'Unverified catalog still suppresses the Offer');
    assert.equal(Object.hasOwn(unavailable, 'sku'), false, 'Unverified fallback cannot invent a SKU');
    assert.equal(unavailable['@id'], baselineProduct['@id']);
    assert.deepEqual(unavailable.additionalProperty, baselineProduct.additionalProperty);
    for (const liveProducts of [[], [{ ...ss31, price: 0 }]]) {
      snapshot = { verified: true, products: liveProducts };
      assert.equal(Object.hasOwn(productNode(await routeStructuredData(path, config)), 'offers'), false, 'Missing/zero-price offer stays suppressed');
    }
    snapshot = { verified: true, products: [{ ...ss31, price: 11000, inStock: false, purchasable: true }] };
    assert.equal(productNode(await routeStructuredData(path, config)).offers.availability, 'https://schema.org/OutOfStock');

    for (const hidden of ['/admin', '/account', '/product/not-listed', ...Object.keys(productReviewBlocks).map(slug => '/product/' + slug)])
      assert.equal(await routeStructuredData(hidden, config), null, hidden + ': publication holds/private paths remain suppressed');
    assert.equal(await routeStructuredData(path, seoConfig()), null, 'Index-disabled preview has no Product graph');
    console.log('PASS: all 17 eligible Product graphs retain 16 source SKUs, omit unassigned SS-31 SKU/internal ID, handle blank values, and preserve stable IDs, Offers, certificates and publication holds without invented GTIN/MPN');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
    else delete require.extensions['.ts'];
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
