/* Exact migration aliases: exercise real catch-all handlers and Next redirects. No network or live data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const { legacyRoutes } = require('../lib/legacy-routes.ts');
const { seoConfig, mayIndex, sitemapPaths, productReviewBlocks, pageRecords } = require('../lib/seo-policy.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

// Real route logic, policy, catalog and Next redirect/notFound functions; only
// rendering, cookies and deployment-specific SEO dependencies are isolated.
const filename = path.join(root, 'app/[...path]/page.tsx');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const originalRequire = loaded.require.bind(loaded);
let seoRequests = 0;
loaded.require = id => {
  if (id === 'next/headers') return { cookies: async () => { throw new Error('Public aliases must not read identity cookies'); } };
  if (id === '@/components/store/experience') return { Experience: () => null };
  if (id === '@/lib/seo') return {
    requestSEO: async () => { seoRequests++; return config; },
    routeMetadata: route => ({ route }),
    routeStructuredData: async () => null,
    jsonLd: JSON.stringify,
  };
  if (id.startsWith('@/lib/')) return originalRequire(path.join(root, id.slice(2)) + '.ts');
  return originalRequire(id);
};
loaded._compile(transpile(filename), filename);
const { default: Page, generateMetadata } = loaded.exports;
const props = url => ({
  // A trailing slash does not produce an extra catch-all segment. Live HTTP
  // checks separately verify the framework's existing slash-normalization hop.
  params: Promise.resolve({ path: new URL(url, 'https://trybiomod.com').pathname.split('/').filter(Boolean) }),
  searchParams: Promise.resolve({}),
});
const mappings = {
  '/es': '/',
  '/es/product/mots-c-10mg': '/product/mots-c-10mg',
  '/es/product/mots-c-40mg': '/product/mots-c-40mg',
  '/es/coa': '/testing',
};

(async () => {
  for (const [source, destination] of Object.entries(mappings)) {
    for (const form of [source, source + '/']) {
      for (const handler of [generateMetadata, Page]) {
        const before = seoRequests;
        await assert.rejects(handler(props(form)), error => error.digest === `NEXT_REDIRECT;replace;${destination};308;`, form + ' must permanently redirect before rendering');
        assert.equal(seoRequests, before, 'an alias must not generate metadata or structured data');
      }
    }
    assert.equal(legacyRoutes[source.slice(1)], destination);
    assert(!legacyRoutes[destination.slice(1)], destination + ' must not chain back into another legacy alias');
    assert(mayIndex(destination, new URLSearchParams(), config), destination + ' must retain its existing eligibility');
    if (destination !== '/') {
      assert.equal((await generateMetadata(props(destination))).route, destination);
      assert(await Page(props(destination)), 'the real route must accept the destination');
    } else assert(pageRecords['/'], 'the homepage destination must already exist');
  }
  assert.deepEqual(Object.keys(legacyRoutes).filter(key => key === 'es' || key.startsWith('es/')).sort(), Object.keys(mappings).map(key => key.slice(1)).sort(), 'only the four evidenced Spanish aliases may be added');
  for (const unknown of ['/es/not-a-real-page', '/es/product/not-a-real-product', '/es/product/bpc-157-10mg', '/es/product/heat-r-20mg', '/es/coa/extra']) {
    for (const form of [unknown, unknown + '/']) {
      for (const handler of [generateMetadata, Page]) {
        await assert.rejects(handler(props(form)), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404', form + ' must remain a genuine 404, not a blanket Spanish redirect');
      }
    }
  }
  const sitemap = sitemapPaths(config);
  assert(!sitemap.some(route => route === '/es' || route.startsWith('/es/')), 'legacy aliases must not enter the sitemap');
  for (const slug of Object.keys(productReviewBlocks)) {
    const route = '/product/' + slug;
    assert(!mayIndex(route, new URLSearchParams(), config), slug + ' hold must remain active');
    assert(!sitemap.includes(route), slug + ' must remain outside the sitemap');
  }
  console.log('PASS: exact Spanish aliases use real permanent redirects in page and metadata handlers, both slash forms, valid destinations, no loops, unknown paths return404, all publication holds preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
