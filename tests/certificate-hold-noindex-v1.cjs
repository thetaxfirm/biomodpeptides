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
// Reports moved from the retired host keep their source record; the file must still be the recorded original.
const hosted = require('../lib/coa-hosted-files-v1.json');
const source = require('../lib/coas-source-v1.json');
const { laboratoryDocuments, batchRecords, hostedDocumentUrl } = require('../lib/testing.ts');
for (const [url, file] of Object.entries(hosted.documents)) {
  const record = source.records.find(r => r.coa_pdf_url === url), document = source.documents.find(d => d.url === url);
  assert.ok(record && document?.is_certificate, url + ' is a recorded certificate of one product');
  assert.match(file.path, /^\/certificates\/[A-Za-z0-9._-]+\.pdf$/);
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'public', file.path))).digest('hex'), document.sha256, file.path + ' is the recorded original, byte for byte');
  assert.equal(file.sha256, document.sha256);
  assert.equal(hostedDocumentUrl(url), 'https://trybiomod.com' + file.path);
  slugFor[file.path] = record.product_slug;
}
assert.equal(hostedDocumentUrl('https://biomodpeptides.com/wp-content/uploads/2026/05/Selank-10mg.pdf'), 'https://biomodpeptides.com/wp-content/uploads/2026/05/Selank-10mg.pdf', 'A report that is not hosted here keeps its recorded address');
// No public record or document may still send a reader, or a crawler, to a moved report on the old host.
const leftovers = JSON.stringify([laboratoryDocuments, batchRecords]).match(/https:\/\/biomodpeptides\.com\/wp-content\/[^"]+\.pdf/g) || [];
assert.deepEqual(leftovers.filter(url => Object.hasOwn(hosted.documents, url)), [], 'Moved reports are addressed on this site everywhere');
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
assert.ok(held.includes('klow-80mg') && !held.includes('run-gun-10mg'), 'KLOW stays held; Run & Gun released Nov 2 2026');
console.log('certificate-hold-noindex-v1 passed (' + held.length + ' held of ' + files.length + ')');
