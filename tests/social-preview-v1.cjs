/* Exercise real route metadata without production bindings, network or customer data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products, imagePath } = require('../lib/catalog.ts');
const { seoConfig, sitemapPaths, pageInfo } = require('../lib/seo-policy.ts');
const publication = require('../lib/seo-publication-v1.json');
const origin = 'https://trybiomod.com';
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const config = seoConfig(env);
const originalLoad = Module._load;
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden in social-preview tests'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === './public-catalog') return { publicCatalog: async () => { throw new Error('Unexpected catalog read'); } };
    if (request === './merchant-policies') return { merchantPolicies: async () => { throw new Error('Unexpected commerce read'); } };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
try {
  const { routeMetadata } = require('../lib/seo.ts');
  const expectedImage = { url: origin + '/brand/logo-navy-tm-v36.png', width: 1320, height: 381, type: 'image/png', alt: 'Biomod Peptides logo' };
  const png = fs.readFileSync(path.join(__dirname, '../public/brand/logo-navy-tm-v36.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Shared image is an existing PNG');
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), expectedImage.width, 'Metadata width matches the actual raster');
  assert.equal(png.readUInt32BE(20), expectedImage.height, 'Metadata height matches the actual raster');

  const editorialPaths = sitemapPaths(config).filter(p => !p.startsWith('/product/'));
  assert(editorialPaths.includes('/') && editorialPaths.includes('/shop') && editorialPaths.some(p => p.startsWith('/news/')));
  for (const route of editorialPaths) {
    const metadata = routeMetadata(route, new URLSearchParams(), config);
    const info = pageInfo(route), title = route === '/' ? info.title : info.title + ' | Biomod Peptides';
    assert.deepEqual(metadata.openGraph.images, [expectedImage], route + ': branded Open Graph image');
    assert.deepEqual(metadata.twitter.images, [{ url: expectedImage.url, alt: expectedImage.alt }], route + ': explicit Twitter image');
    assert.equal(metadata.twitter.card, 'summary', route + ': existing card presentation retained');
    assert.deepEqual(metadata.title, { absolute: title });
    assert.equal(metadata.description, info.description);
    assert.equal(metadata.openGraph.url, origin + route);
    assert.equal(metadata.openGraph.title, title);
    assert.equal(metadata.alternates.canonical, origin + route);
    assert.equal(metadata.robots.index, true);
  }
  assert.deepEqual(routeMetadata('/news', new URLSearchParams('utm_source=press'), config).openGraph.images, [expectedImage], 'Allowed attribution parameters keep the public preview');

  for (const product of products) {
    const route = '/product/' + product.slug;
    const metadata = routeMetadata(route, new URLSearchParams(), config);
    assert.deepEqual(metadata.openGraph.images, [{ url: origin + imagePath(product), alt: product.image.alt || product.name }], product.slug + ': product artwork unchanged');
    assert.deepEqual(metadata.twitter, { card: 'summary', title: pageInfo(route).title + ' | Biomod Peptides', description: pageInfo(route).description }, product.slug + ': product Twitter metadata unchanged');
  }

  for (const route of ['/admin', '/admin/login', '/account', '/checkout', '/softgels', '/locations', '/not-a-page', '/product/not-a-product', '/about-biomod']) {
    const metadata = routeMetadata(route, new URLSearchParams(), config);
    assert.equal(metadata.robots.index, false, route + ': indexing hold retained');
    assert.equal(metadata.openGraph.images, undefined, route + ': no new fallback');
    assert.equal(metadata.twitter.images, undefined, route + ': no new Twitter image');
  }
  for (const query of ['measurement=off', 'search=unreviewed']) {
    const metadata = routeMetadata('/', new URLSearchParams(query), config);
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.openGraph.images, undefined);
    assert.equal(metadata.twitter.images, undefined);
  }
  for (const preview of [seoConfig(), seoConfig({ ...env, SEO_PUBLIC_LAUNCH_APPROVED: 'false' }), seoConfig({ ...env, SEO_INDEXING_ENABLED: 'false' })]) {
    const metadata = routeMetadata('/', new URLSearchParams(), preview);
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.openGraph.images, undefined);
    assert.equal(metadata.twitter.images, undefined);
  }
  console.log('PASS: public editorial/store share images, actual PNG dimensions, retained metadata and product artwork, private/held/preview suppression');
} finally { Module._load = originalLoad; global.fetch = originalFetch; }
