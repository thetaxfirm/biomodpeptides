/* Held products stay out of search, including their certificate PDFs. Static PDFs bypass the
   proxy's X-Robots-Tag, so public/_headers must carry noindex for every certificate whose product
   is not indexable, and must not hide certificates of indexable products (Bing had indexed the
   held KLOW certificate). Uses the published release configuration and the real hold list. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...rest); };
const { seoConfig, mayIndex } = require('../lib/seo-policy.ts');
const release = require('../lib/seo-publication-v1.json');
const coas = require('../lib/coas-reconciliations-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

// _headers: a path line followed by indented header lines.
const rules = {};
let current = null;
for (const line of fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (/^\s/.test(line)) { assert.ok(current, 'header line follows a path'); rules[current].push(line.trim()); } else { current = line.trim(); rules[current] = rules[current] || []; }
}
const noindexed = p => Object.entries(rules).some(([pattern, headers]) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(p) && headers.some(h => /^X-Robots-Tag:.*\bnoindex\b/i.test(h)));

const slugFor = {};
for (const r of coas.reconciliations) if (r.source_url) slugFor[new URL(r.source_url).pathname] = r.product_slug;
const files = fs.readdirSync(path.join(root, 'public/certificates')).filter(f => f.endsWith('.pdf'));
assert.ok(files.length >= 5, 'certificates found');
const held = [];
for (const f of files) {
  const p = '/certificates/' + f;
  const slug = slugFor[p];
  assert.ok(slug, p + ' maps to a product in coas-reconciliations-v1.json');
  const indexable = mayIndex('/product/' + slug, new URLSearchParams(), config);
  assert.equal(noindexed(p), !indexable, p + (indexable ? ' (indexable product) stays indexable' : ' (held product ' + slug + ') is noindex'));
  if (!indexable) held.push(slug);
}
assert.ok(held.includes('klow-80mg') && held.includes('run-gun-10mg'), 'known held certificates covered');
console.log('certificate-hold-noindex-v1 passed (' + held.length + ' held of ' + files.length + ')');
