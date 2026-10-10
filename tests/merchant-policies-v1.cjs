/* Real policy/SEO/config functions with isolated store settings and catalog.
 * No network, Cloudflare bindings, orders, customer data, or database writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const { seoConfig, sitemapPaths, mayIndex, pageRecords, productReviewBlocks } = require('../lib/seo-policy.ts');
const { certificateProperties } = require('../lib/certificate-schema.ts');
const origin = 'https://trybiomod.com';
const productPath = '/product/bpc-157-10mg';
const bpc = products.find(p => p.slug === 'bpc-157-10mg');
assert(bpc);
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: 'bpc-157-10mg,heat-r-20mg,softgel-methylene-blue-usp' };
const live = seoConfig(env);
let stored = { freeShippingAt: 20000, shippingCents: 1250 };
let settingReads = 0, catalogReads = 0, storageUnavailable = false;
let catalogSnapshot = { verified: true, products: [{ ...bpc, price: 12345, purchasable: true, inStock: true }] };
const originalLoad = Module._load, originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return {
    setting: async (key, fallback) => { settingReads++; assert.equal(key, 'store'); if (storageUnavailable) throw new Error('Storage unavailable'); return stored ?? fallback; },
    all: async () => { throw new Error('Unexpected catalog/database access'); },
    one: async () => { throw new Error('Unexpected row access'); },
  };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => { catalogReads++; return catalogSnapshot; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData, routeMetadata } = require('../lib/seo.ts');
const organizationOf = data => data['@graph'].find(n => n['@type'] === 'Organization');
const productOf = data => data['@graph'].find(n => n['@type'] === 'Product');
const returnId = origin + '/returns-refunds#policy';
const shippingId = origin + '/shipping-policy#standard-shipping';
function assertReturnPolicy(policy) {
  assert.deepEqual(policy, { '@type': 'MerchantReturnPolicy', '@id': returnId, merchantReturnLink: origin + '/returns-refunds' });
}
function assertShippingPolicy(policy) {
  assert.equal(policy['@type'], 'ShippingService');
  assert.equal(policy['@id'], shippingId);
  assert.equal(policy.fulfillmentType, 'https://schema.org/FulfillmentTypeDelivery');
  assert.deepEqual(policy.shippingConditions, [{
    '@type': 'ShippingConditions',
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
    orderValue: { '@type': 'MonetaryAmount', minValue: 200, currency: 'USD' },
    shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
  }], 'Free shipping applies only to U.S. orders meeting the published threshold');
  assert.match(policy.description, /after discounts and before tax/);
  assert.match(policy.description, /lower order totals.*checkout before payment/);
}
function assertNoInventedClaims(value) {
  const banned = new Set(['aggregateRating', 'review', 'ratingValue', 'reviewCount', 'transitTime', 'handlingTime', 'deliveryTime', 'merchantReturnDays', 'returnPolicyCategory', 'returnFees', 'returnMethod']);
  function visit(node) {
    if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) { assert(!banned.has(key), 'No unsupported claim: ' + key); visit(child); }
  }
  visit(value);
}
(async () => {
  const originalStaticPaths = ['/', '/shop', '/about', '/contact', '/testing', '/quality-standard', '/choosing-a-research-supplier', '/research-use-only', '/faq'];
  const expectedStaticPaths = [...originalStaticPaths, '/shipping-policy', '/returns-refunds'].sort();
  assert.deepEqual(Object.keys(pageRecords).filter(path => pageRecords[path].eligible).sort(), expectedStaticPaths, 'Only two policy pages are added to the prior public page set');
  assert.deepEqual(sitemapPaths(live).sort(), [...expectedStaticPaths, productPath].sort());
  for (const path of ['/shipping-policy', '/returns-refunds', productPath]) {
    const data = await routeStructuredData(path, live);
    const organization = organizationOf(data);
    assert.equal(data['@graph'].filter(n => n['@type'] === 'Organization').length, 1);
    assertReturnPolicy(organization.hasMerchantReturnPolicy);
    assertShippingPolicy(organization.hasShippingService);
    assertNoInventedClaims(data);
    assert.equal(routeMetadata(path, new URLSearchParams(), live).robots.index, true);
    assert.equal(routeMetadata(path, new URLSearchParams(), live).alternates.canonical, origin + path);
    if (path === productPath) {
      const product = productOf(data), offer = product.offers;
      assert.equal(offer.price, '123.45');
      assert.equal(offer.availability, 'https://schema.org/InStock');
      assert.deepEqual(offer.hasMerchantReturnPolicy, { '@id': organization.hasMerchantReturnPolicy['@id'] });
      assert.deepEqual(offer.shippingDetails, { '@type': 'OfferShippingDetails', hasShippingService: { '@id': organization.hasShippingService['@id'] } });
      for (const property of certificateProperties(bpc.id)) assert(product.additionalProperty.some(actual => JSON.stringify(actual) === JSON.stringify(property)), 'Existing certificate properties preserved');
    }
  }
  const content = fs.readFileSync(require.resolve('../components/store/content.tsx'), 'utf8');
  assert.match(content, /Standard shipping is free on orders of \$200 or more after discounts and before tax/);
  assert.match(content, /Research product sales are generally final/);
  assert.match(content, /within 48 hours of delivery/);

  // No default shipping claims leak when the current settings read fails.
  storageUnavailable = true;
  for (const path of ['/shipping-policy', '/returns-refunds', productPath]) {
    const data = await routeStructuredData(path, live);
    assertReturnPolicy(organizationOf(data).hasMerchantReturnPolicy);
    assert.equal(organizationOf(data).hasShippingService, undefined);
    if (path === productPath) {
      assert.equal(productOf(data).offers.price, '123.45', 'Shipping configuration failure does not remove a verified merchandise offer');
      assert.equal(productOf(data).offers.shippingDetails, undefined);
      assert.deepEqual(productOf(data).offers.hasMerchantReturnPolicy, { '@id': returnId });
    }
    assertNoInventedClaims(data);
  }
  storageUnavailable = false;
  for (const freeShippingAt of [25000, 19999, 0, -1, 20000.5, '20000', null, undefined, NaN, Infinity]) {
    stored = { freeShippingAt, shippingCents: 1250 };
    const data = await routeStructuredData(productPath, live);
    assert.equal(organizationOf(data).hasShippingService, undefined, 'Invalid or changed threshold omits shipping: ' + String(freeShippingAt));
    assert.equal(productOf(data).offers.shippingDetails, undefined);
  }
  stored = null;
  assertShippingPolicy(organizationOf(await routeStructuredData('/shipping-policy', live)).hasShippingService);
  stored = { freeShippingAt: 20000, shippingCents: 1250 };
  catalogSnapshot = { verified: false, products: [{ ...bpc, price: 12345 }] };
  const unverified = await routeStructuredData(productPath, live);
  assert.equal(productOf(unverified).offers, undefined, 'Unverified catalog fallback is never a live merchandise offer');
  assertShippingPolicy(organizationOf(unverified).hasShippingService);
  catalogSnapshot = { verified: true, products: [{ ...bpc, price: 12345, purchasable: true, inStock: false }] };
  assert.equal(productOf(await routeStructuredData(productPath, live)).offers.availability, 'https://schema.org/OutOfStock');
  for (const product of [{ ...bpc, price: 0 }, null]) {
    catalogSnapshot = { verified: true, products: product ? [product] : [] };
    assert.equal(productOf(await routeStructuredData(productPath, live)).offers, undefined);
  }

  // Unchanged routes do not acquire extra configuration or catalog reads.
  const readsBefore = [settingReads, catalogReads];
  for (const path of ['/', '/about', '/shop']) {
    const data = await routeStructuredData(path, live);
    assert.equal(organizationOf(data).hasShippingService, undefined);
  }
  for (const path of ['/account', '/admin', '/cart', '/checkout', '/terms-of-sale', '/privacy-policy', '/locations', '/multi-pack', '/missing-page', '/about-biomod', '/product/not-listed', ...Object.keys(productReviewBlocks).map(slug => '/product/' + slug)]) {
    assert.equal(await routeStructuredData(path, live), null, path + ': existing publication suppression preserved');
    assert.equal(routeMetadata(path, new URLSearchParams(), live).robots.index, false);
  }
  for (const path of ['/shipping-policy', '/returns-refunds', productPath]) {
    assert.equal(await routeStructuredData(path, seoConfig()), null, 'Preview has no policy graph');
    assert.equal(routeMetadata(path, new URLSearchParams(), seoConfig()).robots.index, false);
    assert.equal(mayIndex(path, new URLSearchParams('q=test'), live), false);
    assert.equal(routeMetadata(path, new URLSearchParams('q=test'), live).robots.index, false);
  }
  assert.deepEqual([settingReads, catalogReads], readsBefore, 'Suppressed and unrelated pages do not touch store data');
  console.log('PASS: truthful conditional U.S. shipping, link-only returns, stable in-document Offer references, live-config failure/mismatch suppression, verified catalog offers, preserved certificates/publication holds, and exactly two policy sitemap additions');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
