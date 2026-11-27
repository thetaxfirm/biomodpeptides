/* A permanent redirect says only where the page moved. Search Console (Nov 27 2026) listed old
   addresses such as /about-biomod, /coa and /es/tag/... under "Excluded by noindex" rather than
   "Page with redirect", because the proxy put X-Robots-Tag: noindex on them before the page
   redirected. Runs the real proxy with the published release configuration; no network.
   Also: each hosted lab report of an indexable product names this site's copy as canonical. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const release = require('../lib/seo-publication-v1.json');
const env = { SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') };
const { seoConfig, mayIndex, sitemapPaths } = require('../lib/seo-policy.ts');
const { legacyRoutes, movedPermanently } = require('../lib/legacy-routes.ts');
const config = seoConfig(env);

const filename = path.join(root, 'proxy.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const real = loaded.require.bind(loaded);
loaded.require = id => {
  if (id === 'next/server') return { NextResponse: { next: () => ({ kind: 'next', headers: new Headers() }), redirect: (url, status) => ({ kind: 'redirect', url: String(url), status, headers: new Headers() }) } };
  if (id === './lib/runtime') return { runtime: () => env, database: () => { throw Error('No database in this test'); } };
  if (id === './lib/restaurant-partners') return { linkSlugCandidate: () => null, partnerCodeForSlug: () => null, partnerSlots: async () => [] };
  return real(id.startsWith('./lib/') ? path.join(root, id) + '.ts' : id);
};
loaded._compile(transpile(filename), filename);
const robots = async (url, method = 'GET') => {
  const response = await loaded.exports.proxy({ nextUrl: new URL(url), method });
  return { kind: response.kind, tag: response.headers.get('X-Robots-Tag') };
};

(async () => {
  const origin = release.origin;
  // Every old address in the table, and the two renamed pages, pass through with no robots header.
  const moved = [...Object.keys(legacyRoutes), 'about-biomod', 'coa'];
  assert.ok(moved.length > 150, 'the redirect table is loaded');
  for (const route of moved) {
    assert.ok(movedPermanently('/' + route), route + ' is recognised as moved');
    assert.deepEqual(await robots(origin + '/' + route), { kind: 'next', tag: null }, '/' + route + ' redirects without a noindex header');
    assert.equal(mayIndex('/' + route, new URLSearchParams(), config), false, '/' + route + ' is not itself a published page');
  }
  assert.ok(movedPermanently('/coa/') && movedPermanently('coa'), 'slashes do not matter');
  // The page really does redirect the two renamed addresses permanently.
  const page = fs.readFileSync(path.join(root, 'app/[...path]/page.tsx'), 'utf8');
  assert.match(page, /if \(legacyRoutes\[route\]\) permanentRedirect\(legacyRoutes\[route\]\)/);
  assert.match(page, /route === 'about-biomod'\) permanentRedirect\('\/about'\)/);
  assert.match(page, /route === 'coa'\) permanentRedirect\('\/testing'\)/);
  // Nothing else changed: pages that are not published keep noindex, private ones keep nofollow.
  assert.deepEqual(await robots(origin + '/multi-pack'), { kind: 'next', tag: 'noindex, follow' });
  assert.deepEqual(await robots(origin + '/faq?universally_switch=source'), { kind: 'next', tag: 'noindex, follow' });
  assert.deepEqual(await robots(origin + '/no-such-page'), { kind: 'next', tag: 'noindex, follow' });
  assert.equal((await robots(origin + '/account')).tag, 'noindex, nofollow');
  assert.equal((await robots(origin + '/admin')).tag, 'noindex, nofollow');
  assert.ok(!movedPermanently('/affiliate-program'), 'the affiliate alias leads to a private page and stays noindex');
  assert.match((await robots(origin + '/affiliate-program')).tag, /noindex/);
  // Published pages carry no robots header at all.
  const published = sitemapPaths(config);
  assert.ok(published.length >= 60);
  for (const p of published) assert.deepEqual(await robots(origin + p), { kind: 'next', tag: null }, p + ' stays indexable');
  // Another host is never indexable, moved or not.
  const elsewhere = await robots('https://preview.example.invalid/coa');
  assert.ok(elsewhere.kind === 'redirect' || elsewhere.tag === 'noindex, nofollow', 'a moved address on another host is still kept out of search');

  // Hosted lab reports: canonical on this site for indexable products, none on held ones.
  const hosted = require('../lib/coa-hosted-files-v1.json');
  const rules = {};
  let current = null;
  for (const line of fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) rules[current].push(line.trim()); else { current = line.trim(); rules[current] = rules[current] || []; }
  }
  let canonical = 0;
  for (const file of Object.values(hosted.documents)) {
    const headers = rules[file.path] || [];
    const held = headers.some(h => /^X-Robots-Tag:.*\bnoindex\b/i.test(h));
    const link = headers.find(h => /^Link:/i.test(h));
    if (held) assert.equal(link, undefined, file.path + ' is held and names no canonical');
    else { assert.equal(link, 'Link: <' + origin + file.path + '>; rel="canonical"', file.path + ' names this site as canonical'); canonical++; }
  }
  assert.equal(canonical, 11);
  console.log('PASS: ' + moved.length + ' permanent redirects carry no noindex header; unpublished, private and other-host addresses unchanged; ' + published.length + ' published pages stay indexable; ' + canonical + ' hosted reports name this site as canonical.');
})().catch(error => { console.error(error); process.exit(1); });
