/* Robots: private store pages are not disallowed, so crawlers can read their noindex header and
   drop them from the index (Bing listed /account/affiliate while /account was disallowed). Each
   such page is still private and never indexable. Exercises the real robots route. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const { seoConfig, privatePath, mayIndex, crawlBlockedPaths } = require('../lib/seo-policy.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

const filename = path.join(root, 'app/robots.txt/route.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const originalRequire = loaded.require.bind(loaded);
loaded.require = id => id === '@/lib/seo' ? { seoForOrigin: () => config } : id.startsWith('@/lib/') ? originalRequire(path.join(root, id.slice(2)) + '.ts') : originalRequire(id);
loaded._compile(transpile(filename), filename);

(async () => {
  const body = await loaded.exports.GET(new Request('https://trybiomod.com/robots.txt')).text();
  const disallowed = [...body.matchAll(/^Disallow: (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(disallowed, crawlBlockedPaths);
  for (const p of ['/admin', '/api/', '/auth/', '/payment/']) assert.ok(disallowed.includes(p), p + ' stays disallowed');
  assert.match(body, /^Sitemap: https:\/\/trybiomod\.com\/sitemap\.xml$/m);
  const blocked = p => disallowed.some(d => p === d.replace(/\/$/, '') || p.startsWith(d.endsWith('/') ? d : d + '/'));
  for (const p of ['/account', '/account/affiliate', '/account/orders', '/cart', '/checkout', '/login', '/register', '/forgot-password', '/reset-password']) {
    assert.ok(!blocked(p), p + ' is crawlable so its noindex can be read');
    assert.ok(privatePath(p), p + ' gets the private noindex, nofollow header');
    assert.equal(mayIndex(p, new URLSearchParams(), config), false, p + ' is never indexable');
  }
  console.log('robots-noindex-crawlable-v1 passed');
})().catch(e => { console.error(e); process.exit(1); });
