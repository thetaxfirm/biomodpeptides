/* Sitemap lastmod: every sitemap URL carries one valid, non-future W3C date; product and
   press pages are never dated before their own content. Exercises the real sitemap route. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const { seoConfig, sitemapPaths } = require('../lib/seo-policy.ts');
const { lastmodFor, siteLastmod, productLastmod, pageLastmod } = require('../lib/sitemap-lastmod.ts');
const { pressReleases } = require('../lib/press-releases.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

const filename = path.join(root, 'app/sitemap.xml/route.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const originalRequire = loaded.require.bind(loaded);
loaded.require = id => id === '@/lib/seo' ? { seoForOrigin: () => config } : id.startsWith('@/lib/') ? originalRequire(path.join(root, id.slice(2)) + '.ts') : originalRequire(id);
loaded._compile(transpile(filename), filename);

(async () => {
  const xml = await loaded.exports.GET(new Request('https://trybiomod.com/sitemap.xml')).text();
  const entries = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map(m => [m[1].slice(release.origin.length) || '/', m[2]]);
  const paths = sitemapPaths(config);
  assert.equal((xml.match(/<url>/g) || []).length, paths.length, 'every sitemap entry has exactly one loc and lastmod');
  assert.deepEqual(entries.map(e => e[0]), paths);
  const today = new Date().toISOString().slice(0, 10);
  const launch = '2026-10-08'; // first verified production indexing release
  for (const [route, date] of entries) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, route);
    assert(!Number.isNaN(Date.parse(date + 'T00:00:00Z')), route + ' real date');
    assert(date >= launch && date <= today, route + ' lastmod ' + date + ' must fall between launch and today');
    assert(date >= siteLastmod, route + ' predates the sitewide header/footer change');
  }
  for (const r of pressReleases) assert(lastmodFor('/news/' + r.slug) >= r.date, r.slug + ' lastmod before publication');
  for (const slug of release.productSlugs) assert.equal(lastmodFor('/product/' + slug), productLastmod);
  for (const route of Object.keys(pageLastmod)) assert(paths.includes(route), route + ' dated but not in the sitemap');
  // Honest by construction: not every page shares one date.
  assert(new Set(entries.map(e => e[1])).size > 1, 'lastmod must not stamp every URL with the same date');
  assert.equal(sitemapPaths(seoConfig()).length, 0);
  console.log('PASS: ' + entries.length + ' sitemap URLs carry valid lastmod dates between launch and today; press and product pages are never dated before their content');
})().catch(error => { console.error(error); process.exit(1); });
