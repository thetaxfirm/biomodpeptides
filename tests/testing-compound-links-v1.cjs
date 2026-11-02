/* Batch records on /testing link to the compound reference page for published products, so the
 * reference pages are reachable from the indexed batch library; held products get no link. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const publication = require('../lib/seo-publication-v1.json');
const holds = require('../lib/product-specification-review-v1.json');
const { compounds, publishedReferenceFor, publishedCompound } = require('../lib/compound-reference.ts');

for (const slug of publication.productSlugs.filter(slug => !holds[slug])) {
  const c = compounds.find(c => c.products.includes(slug));
  if (c) assert.equal(publishedReferenceFor(slug)?.slug, c.slug, slug + ' links to its compound reference');
}
assert.equal(publishedReferenceFor('bpc-157-10mg')?.slug, 'bpc-157');
for (const slug of Object.keys(holds)) assert.equal(publishedReferenceFor(slug), undefined, slug + ' is held: no reference link from its batch record');
assert.equal(publishedReferenceFor('not-a-product'), undefined);
for (const c of compounds) if (!publishedCompound(c)) for (const slug of c.products) assert.equal(publishedReferenceFor(slug), undefined, c.slug + ' is unpublished: never linked');

const source = fs.readFileSync(path.join(root, 'components/store/testing.tsx'), 'utf8');
assert(/publishedReferenceFor\(r\.product_slug\)/.test(source), 'Batch records use the published-reference gate');
assert(/href=\{'\/compounds\/'\+c\.slug\}/.test(source), 'Batch records link to /compounds/<slug>');
console.log('testing-compound-links-v1 passed');
