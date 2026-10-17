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
    runtime: () => ({}),
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
function assertShippingPolicy(policy, threshold = 200) {
  assert.equal(policy['@type'], 'ShippingService');
  assert.equal(policy['@id'], shippingId);
  assert.equal(policy.fulfillmentType, 'https://schema.org/FulfillmentTypeDelivery');
  assert.deepEqual(policy.shippingConditions, [{
    '@type': 'ShippingConditions',
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
    orderValue: { '@type': 'MonetaryAmount', minValue: threshold, currency: 'USD' },
    shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
  }], 'Free shipping applies only to U.S. orders meeting the published threshold');
  if (threshold > 0) assert.match(policy.description, /after discounts and before tax/);
  assert.match(policy.description, /lower order totals.*checkout before payment/);
  assertHandlingTime(policy.handlingTime);
}
// Published policy: weekday orders before 2 p.m. Pacific normally process the same business day.
function assertHandlingTime(period) {
  assert.equal(period['@type'], 'ServicePeriod');
  assert.deepEqual(period.duration, { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' });
  assert.deepEqual(period.businessDays.dayOfWeek, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => 'https://schema.org/' + day));
  assert.match(period.cutoffTime, /^14:00:00-0[78]:00$/);
}
function assertNoInventedClaims(value) {
  const banned = new Set(['aggregateRating', 'review', 'ratingValue', 'reviewCount', 'deliveryTime', 'merchantReturnDays', 'returnPolicyCategory', 'returnFees', 'returnMethod']);
  function visit(node) {
    if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) { assert(!banned.has(key), 'No unsupported claim: ' + key); visit(child); }
  }
  visit(value);
}
(async () => {
  const originalStaticPaths = ['/', '/shop', '/about', '/contact', '/testing', '/quality-standard', '/choosing-a-research-supplier', '/research-use-only', '/faq'];
  // '/news' (newsroom index, October 12, 2026) is the only later static addition; see tests/newsroom-v1.cjs.
  const expectedStaticPaths = [...originalStaticPaths, '/shipping-policy', '/returns-refunds', '/news'].sort();
  assert.deepEqual(Object.keys(pageRecords).filter(path => pageRecords[path].eligible && !path.startsWith('/news/')).sort(), expectedStaticPaths, 'Only two policy pages are added to the prior public page set');
  const releasePaths = require('../lib/press-releases.ts').pressReleases.map(release => '/news/' + release.slug);
  assert.deepEqual(sitemapPaths(live).sort(), [...expectedStaticPaths, ...releasePaths, productPath].sort());
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
  assert.match(content, /shippingTerms/);
  assert.doesNotMatch(content, /Standard shipping is free on orders of \$200/);
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
  // Published policy and schema follow the same current admin configuration.
  for (const freeShippingAt of [25000, 19999, 0]) {
    stored = { freeShippingAt, shippingCents: 1250 };
    const data = await routeStructuredData(productPath, live);
    assertShippingPolicy(organizationOf(data).hasShippingService, freeShippingAt / 100);
    assert.deepEqual(productOf(data).offers.shippingDetails.hasShippingService, { '@id': shippingId });
  }
  // Owner, Oct 17 2026: with only USPS Priority and Express on, Priority is the free service at the threshold.
  const service = (key, label, enabled = true) => ({ key, enabled, markupCents: key === 'USPS:EXPRESS' ? 1000 : 0, label, note: '' });
  stored = { freeShippingAt: 25000, shippingOptions: { freeStandardEnabled: true, services: [service('USPS:GROUNDADVANTAGE', 'USPS Ground Advantage', false), service('USPS:PRIORITY', 'USPS Priority Mail'), service('USPS:EXPRESS', 'USPS Priority Mail Express')] } };
  {
    const policy = organizationOf(await routeStructuredData(productPath, live)).hasShippingService;
    assert.equal(policy.name, 'USPS Priority Mail');
    assert.match(policy.description, /^USPS Priority Mail is free on orders of \$250 or more after discounts and before tax\. Faster services are priced separately\./);
    assertHandlingTime(policy.handlingTime);
    const [condition] = policy.shippingConditions;
    assert.deepEqual(condition.orderValue, { '@type': 'MonetaryAmount', minValue: 250, currency: 'USD' });
    assert.deepEqual(condition.shippingRate, { '@type': 'MonetaryAmount', value: 0, currency: 'USD' });
    assert.deepEqual(condition.transitTime.duration, { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' }, 'Transit days come from the USPS Priority catalog estimate');
  }
  stored = { freeShippingAt: 25000, shippingOptions: { freeStandardEnabled: true, services: [service('USPS:EXPRESS', 'USPS Priority Mail Express')] } };
  assert.equal(organizationOf(await routeStructuredData(productPath, live)).hasShippingService, undefined, 'Priority Mail Express is never the free service');
  for (const shippingOptions of [{freeStandardEnabled:false}, {standardEnabled:false}]) {
    stored = { freeShippingAt: 20000, shippingOptions };
    const data = await routeStructuredData(productPath, live);
    assert.equal(organizationOf(data).hasShippingService, undefined, 'Disabled free standard shipping has no free shipping schema');
    assert.equal(productOf(data).offers.shippingDetails, undefined);
  }
  for (const freeShippingAt of [-1, 20000.5, '20000', null, undefined, NaN, Infinity]) {
    stored = { freeShippingAt, shippingCents: 1250 };
    const data = await routeStructuredData(productPath, live);
    assert.equal(organizationOf(data).hasShippingService, undefined, 'Invalid threshold omits shipping: ' + String(freeShippingAt));
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
  console.log('PASS: truthful conditional U.S. shipping, link-only returns, stable in-document Offer references, current shipping settings and failed-read suppression, verified catalog offers, preserved certificates/publication holds, and exactly two policy sitemap additions');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
