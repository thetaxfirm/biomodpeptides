/* Product page headings carry strength and format, like their titles. Isolated: no network or data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products, productFormat } = require('../lib/catalog.ts');
const { productHeading, sizedBottle } = require('../lib/product-discovery.ts');
const bySlug = slug => products.find(p => p.slug === slug);

// Vials keep their sized heading.
assert.equal(productHeading(bySlug('bpc-157-10mg')), 'BPC-157 10 mg');
// Sprays and softgels name format and contents instead of a bare brand name.
assert.equal(productHeading(bySlug('apex-semax-spray')), 'APEX Spray 60 mg');
assert.equal(productHeading(bySlug('flux-nad-spray')), 'FLUX Spray 1000 mg');
assert.equal(productHeading(bySlug('softgel-bionic-bpc-157-arginate-kpv-vitamin-e')), 'BIONIC Softgels 60 caps');
assert.equal(productHeading(bySlug('softgel-nexus-dihexa-j-147')), 'NEXUS Softgels 30 caps');
// A lab supply keeps its own name.
assert.equal(productHeading(bySlug('acetic-acid-solution-1')), 'Acetic Acid Solution 1%');
for (const p of products) {
  const h = productHeading(p);
  assert(h.startsWith(p.name.replace(/\s+\d+(?:\.\d+)?\s*mg$/i, '')), p.slug + ' heading keeps the product name');
  assert(!/bottle|\/\s*vial/i.test(h), p.slug + ' heading drops the unit suffix');
  if (sizedBottle(p)) assert(h.includes(productFormat(p)) && /\d/.test(h), p.slug + ' bottle heading names format and contents');
}
// The product page renders this heading, and does not repeat the contents line under it.
const page = fs.readFileSync(require.resolve('../components/store/catalog.tsx'), 'utf8');
assert(page.includes('<h1>{hasSizeChoices ? vialTitle(p) : productHeading(p)}</h1>'));
assert(page.includes('!sizedVial(p) && !sizedBottle(p) && <p className="detail-size">'));
console.log('product heading v1: ok');
