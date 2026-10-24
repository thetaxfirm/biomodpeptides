/* Old-domain URLs Bing still lists must land on a real page in one app redirect, not a 404.
   Exercises the real catch-all handlers and Next redirects. No network or live data. */
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
const { seoConfig, mayIndex, sitemapPaths } = require('../lib/seo-policy.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

const filename = path.join(root, 'app/[...path]/page.tsx');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const originalRequire = loaded.require.bind(loaded);
loaded.require = id => {
  if (id === 'next/headers') return { cookies: async () => { throw new Error('Public aliases must not read identity cookies'); } };
  if (id === '@/lib/auth') return { customer: async () => { throw new Error('Public aliases must not read identity'); }, staffRole: async () => null };
  if (id === '@/lib/public-catalog') return { publicCatalog: async () => ({ verified: false, products: [] }) };
  if (id === '@/components/store/experience') return { Experience: () => null };
  if (id === '@/lib/seo') return { requestSEO: async () => config, routeMetadata: route => ({ route }), routeStructuredData: async () => null, jsonLd: JSON.stringify };
  if (id.startsWith('@/lib/')) return originalRequire(path.join(root, id.slice(2)) + '.ts');
  return originalRequire(id);
};
loaded._compile(transpile(filename), filename);
const { default: Page, generateMetadata } = loaded.exports;
const props = url => ({ params: Promise.resolve({ path: url.split('/').filter(Boolean) }), searchParams: Promise.resolve({}) });

// Each URL was listed by Bing for site:biomodpeptides.com on October 14, 2026 and ended in a 404.
const mappings = {
  '/biomod-peptide-quality-standards': '/quality-standard',
  '/henderson-lab-supplies-sourcing-high-purity-research-peptides-in-nevada': '/quality-standard',
  '/peptide-supplier-with-third-party-testing-2026-analytical-standards': '/testing',
  '/alternative-to-gray-market-research-chemicals-verified-standards-for-analytical-labs': '/choosing-a-research-supplier',
  '/reliable-peptide-source-in-las-vegas-a-researchers-buying-guide-2026': '/choosing-a-research-supplier',
  '/product-tag/blends': '/shop',
  // Listed by Bing on October 18, 2026 and still ending in a 404.
  '/tag/scientific-reproducibility': '/quality-standard',
  '/tag/reproducibility': '/quality-standard',
  '/tag/research-reproducibility': '/quality-standard',
  '/tag/spray-formulation': '/shop',
  '/tag/longevity-supplement-peptides': '/',
  '/longevity-peptide-stack': '/shop',
  // Listed by Bing on October 23, 2026 and still ending in a 404.
  '/research-peptide-storage-and-inventory-management-2026-laboratory-protocol-guide': '/quality-standard',
  '/research-peptide-sourcing-for-startups-in-las-vegas-a-2026-procurement-guide': '/choosing-a-research-supplier',
  '/comprehensive-checklist-for-vetting-new-lab-peptide-suppliers-in-2026': '/choosing-a-research-supplier',
  '/nevada-research-peptides-a-selection-guide': '/choosing-a-research-supplier',
  '/research-peptides/blends': '/shop',
  '/tag/nevada-research-supply': '/about',
};

(async () => {
  const sitemap = sitemapPaths(config);
  for (const [source, destination] of Object.entries(mappings)) {
    assert.equal(legacyRoutes[source.slice(1)], destination);
    assert(!legacyRoutes[destination.slice(1)], destination + ' must not chain into another alias');
    assert(sitemap.includes(destination), destination + ' must be an indexable sitemap page');
    assert(mayIndex(destination, new URLSearchParams(), config), destination + ' must stay indexable');
    assert(!sitemap.includes(source), source + ' must not enter the sitemap');
    for (const form of [source, source + '/']) for (const handler of [generateMetadata, Page]) {
      await assert.rejects(handler(props(form)), error => error.digest === `NEXT_REDIRECT;replace;${destination};308;`, form + ' must permanently redirect');
    }
  }
  for (const unknown of ['/not-a-real-old-post', '/product-tag/not-a-tag', '/product-tag/blends/extra', '/tag/not-a-tag', '/tag/reproducibility/extra', '/research-peptides', '/research-peptides/not-a-category', '/tag/nevada-research-supply/extra']) {
    for (const handler of [generateMetadata, Page]) {
      await assert.rejects(handler(props(unknown)), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404', unknown + ' must remain a genuine 404');
    }
  }
  console.log('PASS: Bing-listed old-domain URLs permanently redirect to indexable pages, no chains, unknown paths still 404');
})().catch(error => { console.error(error); process.exitCode = 1; });
