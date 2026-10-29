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
  for (const slug of release.productSlugs) assert.equal(lastmodFor('/product/' + slug), [pageLastmod['/product/' + slug] || productLastmod, siteLastmod].sort().at(-1));
  for (const route of Object.keys(pageLastmod)) assert(paths.includes(route), route + ' dated but not in the sitemap');
  // A page whose visible content changed must not keep an older date, or Bing has no reason to
  // recrawl it. The guide pages ContentPage ends with the research vial index (628f8c0, October 16)
  // are read from the component itself, so a page added to that list later is covered too.
  const contentSource = fs.readFileSync(path.join(root, 'components/store/content.tsx'), 'utf8');
  const guideExpr = contentSource.match(/const guide = (.*?); if \(guide\)/s);
  assert(guideExpr && /ResearchVialIndex/.test(contentSource.slice(guideExpr.index, guideExpr.index + guideExpr[0].length + 200)), 'guide pages render the research vial index');
  const guidePages = [...guideExpr[1].matchAll(/path === '([a-z-]+)'/g)].map(m => '/' + m[1]);
  assert.deepEqual(guidePages.slice().sort(), ['/about', '/choosing-a-research-supplier', '/faq', '/quality-standard']);
  for (const route of guidePages) assert(lastmodFor(route) >= '2026-10-16', route + ' gained the vial index on 2026-10-16 but is dated ' + lastmodFor(route));
  // 9595696 changed preorder wording on the shipping policy; 1ef1cb4 added the vial lot field to contact.
  for (const route of ['/shipping-policy', '/contact']) assert(lastmodFor(route) >= '2026-10-14', route + ' changed on 2026-10-14 but is dated ' + lastmodFor(route));
  // 92d01ce (October 17) renamed a header menu item on every page, and da848db changed the
  // shipping wording on every product page: no page may keep a date from before that.
  for (const [route, date] of entries) assert(date >= '2026-10-17', route + ' shows the October 17 header change but is dated ' + date);
  // The footer on every page renders TrademarkNote; d52581c (October 23) changed its wording, so
  // no page may keep an older date. If the footer stops rendering it, this check must be revisited.
  const brandSource = fs.readFileSync(path.join(root, 'components/store/brand-story.tsx'), 'utf8');
  assert(/function Footer\(\)[^\n]*<TrademarkNote\/>/.test(contentSource), 'footer renders the trademark note on every page');
  assert(/The Original RUO Softgel/.test(brandSource.match(/function TrademarkNote[\s\S]*?\n}/)[0]), 'trademark note carries the October 23 wording');
  for (const [route, date] of entries) assert(date >= '2026-10-23', route + ' shows the October 23 footer change but is dated ' + date);
  // A specific page date can never pull a page below the sitewide date.
  for (const route of Object.keys(pageLastmod)) assert.equal(lastmodFor(route), pageLastmod[route] > siteLastmod ? pageLastmod[route] : siteLastmod, route);
  // Honest by construction: every date is a hand-set constant tied to a release, never "today".
  const lastmodSource = fs.readFileSync(path.join(root, 'lib/sitemap-lastmod.ts'), 'utf8');
  assert(!/new Date|Date\.now|toISOString/.test(lastmodSource), 'lastmod dates must be fixed release dates, not computed from the clock');
  assert.equal(sitemapPaths(seoConfig()).length, 0);
  console.log('PASS: ' + entries.length + ' sitemap URLs carry valid lastmod dates between launch and today; press, product and recently changed pages are never dated before their content');
})().catch(error => { console.error(error); process.exit(1); });
